// @effect-diagnostics nodeBuiltinImport:off - Serves fixture pets from a local HTTP server.
import * as NodeHttp from "node:http";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as HttpClient from "effect/http/HttpClient";

import { DEFAULT_PET_SPRITE_BASE64 } from "./defaultPetSprite.ts";
import { installPet } from "./petInstaller.ts";
import { makeZip } from "./testZip.ts";

const sprite = Uint8Array.from(Buffer.from(DEFAULT_PET_SPRITE_BASE64, "base64"));
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const manifest = (id: string, extra: Record<string, unknown> = {}) =>
  text({
    id,
    displayName: `Pet ${id}`,
    description: "Fixture",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
    ...extra,
  });

/** PNG header stub: enough for the size check to reject an atlas of the wrong shape. */
function smallPng(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, 100);
  new DataView(bytes.buffer).setUint32(20, 100);
  return bytes;
}

const packages: Record<string, { readonly downloadUrl?: string; readonly zip?: Uint8Array }> = {
  ok: { zip: makeZip({ "pet.json": manifest("ok"), "spritesheet.webp": sprite }) },
  wrongsize: {
    zip: makeZip({
      "pet.json": manifest("wrongsize", { spritesheetPath: "s.png" }),
      "s.png": smallPng(),
    }),
  },
  mismatch: { zip: makeZip({ "pet.json": manifest("someone-else"), "spritesheet.webp": sprite }) },
  nosheet: { zip: makeZip({ "pet.json": manifest("nosheet") }) },
  notzip: { zip: new TextEncoder().encode("<html>oops</html>") },
  elsewhere: { downloadUrl: "https://example.invalid/pet.zip" },
};

const withService = <A, E>(
  body: (input: {
    readonly origin: string;
    readonly directory: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | HttpClient.HttpClient>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-pet-install-" });
    const server = NodeHttp.createServer((request, response) => {
      const match = /^\/api\/pets\/([^/]+)\/(share-data|download)$/.exec(request.url ?? "");
      const entry = match?.[1] === undefined ? undefined : packages[match[1]];
      if (!match || !entry) {
        response.writeHead(404).end("{}");
      } else if (match[2] === "share-data") {
        const downloadUrl = entry.downloadUrl ?? `/api/pets/${match[1]}/download`;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ pet: { id: match[1], downloadUrl } }));
      } else {
        response.writeHead(200, { "content-type": "application/zip" }).end(entry.zip);
      }
    });
    yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
          }),
      ),
      () =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
            }),
        ),
    );
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    return yield* body({ origin: `http://127.0.0.1:${port}`, directory });
  }).pipe(
    Effect.provide(Layer.mergeAll(NodeHttpClient.layerUndici, NodeServices.layer)),
    Effect.scoped,
  );

describe("installPet", () => {
  it.effect("writes pet.json and the spritesheet for a good package", () =>
    withService(({ origin, directory }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const installed = yield* installPet({ petsDirectory: directory, id: "ok", origin });
        assert.deepEqual(
          { id: installed.id, displayName: installed.displayName },
          { id: "ok", displayName: "Pet ok" },
        );
        const folder = path.join(directory, "ok");
        assert.deepEqual((yield* fileSystem.readDirectory(folder)).sort(), [
          "pet.json",
          "spritesheet.webp",
        ]);
        assert.deepEqual(
          new Uint8Array(yield* fileSystem.readFile(path.join(folder, "spritesheet.webp"))),
          sprite,
        );
      }),
    ),
  );

  it.effect.each([
    { id: "missing", message: "No pet with that id" },
    { id: "wrongsize", message: "100x100" },
    { id: "mismatch", message: "does not match" },
    { id: "nosheet", message: "no spritesheet" },
    { id: "notzip", message: "not a zip" },
    { id: "elsewhere", message: "download elsewhere" },
  ])("refuses $id without leaving a pet behind", ({ id, message }) =>
    withService(({ origin, directory }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const error = yield* installPet({ petsDirectory: directory, id, origin }).pipe(Effect.flip);
        assert.include(String(error), message);
        assert.deepEqual(yield* fileSystem.readDirectory(directory), []);
      }),
    ),
  );

  it.effect("reports an unreachable service plainly", () =>
    withService(({ directory }) =>
      Effect.gen(function* () {
        const error = yield* installPet({
          petsDirectory: directory,
          id: "ok",
          origin: "http://127.0.0.1:1",
        }).pipe(Effect.flip);
        assert.equal(error, "Could not reach the pet service.");
      }),
    ),
  );
});
