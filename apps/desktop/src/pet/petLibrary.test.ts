import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

import { DEFAULT_PET_SPRITE_BASE64 } from "./defaultPetSprite.ts";
import { BUILT_IN_PET, loadPetSprite, scanPets } from "./petLibrary.ts";

/** A PNG header is all the dimension check reads, so a stub stands in for a bad atlas. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const manifest = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ displayName: "Pet", spritesheetPath: "spritesheet.webp", ...extra });

const withPets = <A, E>(
  body: (input: {
    readonly directory: string;
    readonly write: (
      folder: string,
      file: string,
      data: string | Uint8Array,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-pets-" });
    const write = (folder: string, file: string, data: string | Uint8Array) =>
      Effect.gen(function* () {
        yield* fileSystem.makeDirectory(path.join(directory, folder), { recursive: true });
        const target = path.join(directory, folder, file);
        yield* typeof data === "string"
          ? fileSystem.writeFileString(target, data)
          : fileSystem.writeFile(target, data);
      });
    return yield* body({ directory, write });
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("scanPets", () => {
  it.effect("lists valid packages after the built-in pet and reports the rest", () =>
    withPets(({ directory, write }) =>
      Effect.gen(function* () {
        const atlas = Uint8Array.from(Buffer.from(DEFAULT_PET_SPRITE_BASE64, "base64"));
        yield* write("good", "pet.json", manifest({ id: "good-pet" }));
        yield* write("good", "spritesheet.webp", atlas);
        yield* write("v2", "pet.json", manifest({ id: "v2", spritesheetPath: "sheet.png" }));
        yield* write("v2", "sheet.png", pngHeader(1536, 2288));
        yield* write("small", "pet.json", manifest({ id: "small", spritesheetPath: "s.png" }));
        yield* write("small", "s.png", pngHeader(768, 936));
        yield* write("nomanifest", "spritesheet.webp", atlas);
        yield* write(
          "escape",
          "pet.json",
          manifest({ spritesheetPath: "../good/spritesheet.webp" }),
        );
        yield* write("reserved", "pet.json", manifest({ id: "t3" }));
        yield* write("reserved", "spritesheet.webp", atlas);

        const { pets, failures } = yield* scanPets(directory);

        assert.deepEqual(
          pets.map((pet) => pet.id),
          [BUILT_IN_PET.id, "good-pet", "v2"],
        );
        assert.deepEqual(failures.map((failure) => failure.folder).sort(), [
          "escape",
          "nomanifest",
          "small",
        ]);
        assert.include(failures.find((failure) => failure.folder === "small")!.error, "768x936");
      }),
    ),
  );

  it.effect("treats a missing pets folder as no installed pets", () =>
    withPets(({ directory }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const result = yield* scanPets(path.join(directory, "nothing-here"));
        assert.deepEqual(result.pets, [BUILT_IN_PET]);
        assert.deepEqual(result.failures, []);
      }),
    ),
  );
});

describe("loadPetSprite", () => {
  it.effect("returns a data URL for the built-in and an installed pet", () =>
    withPets(({ directory, write }) =>
      Effect.gen(function* () {
        const atlas = Uint8Array.from(Buffer.from(DEFAULT_PET_SPRITE_BASE64, "base64"));
        yield* write("good", "pet.json", manifest({ id: "good" }));
        yield* write("good", "spritesheet.webp", atlas);
        const { pets } = yield* scanPets(directory);
        const builtIn = yield* loadPetSprite(BUILT_IN_PET);
        const installed = yield* loadPetSprite(pets.find((pet) => pet.id === "good")!);
        assert.equal(builtIn, `data:image/webp;base64,${DEFAULT_PET_SPRITE_BASE64}`);
        assert.equal(installed, builtIn);
      }),
    ),
  );
});
