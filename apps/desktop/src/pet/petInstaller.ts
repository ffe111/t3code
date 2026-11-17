import { readImageDimensions } from "@t3tools/shared/imageDimensions";
import {
  PET_MAX_SPRITESHEET_BYTES,
  parsePetManifest,
  parsePetReference,
  validatePetAtlas,
} from "@t3tools/shared/petPackage";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";

import { readPetArchive } from "./petArchive.ts";

export const PET_GALLERY_ORIGIN = "https://codex-pets.net";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_LOOKUP_BYTES = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;

export interface InstalledPet {
  readonly id: string;
  readonly displayName: string;
  readonly directory: string;
}

const request = (url: string, limit: number, notFound = "No pet with that id was found.") =>
  HttpClient.get(url).pipe(
    Effect.timeout(REQUEST_TIMEOUT_MS),
    Effect.flatMap((response) => {
      if (response.status === 404) return Effect.fail(notFound);
      if (response.status < 200 || response.status >= 300) {
        return Effect.fail(`The pet service answered ${response.status}.`);
      }
      if (Number(response.headers["content-length"] ?? 0) > limit) {
        return Effect.fail("The download is too large.");
      }
      return response.arrayBuffer.pipe(
        Effect.flatMap((buffer) =>
          buffer.byteLength > limit
            ? Effect.fail("The download is too large.")
            : Effect.succeed(new Uint8Array(buffer)),
        ),
      );
    }),
    Effect.mapError((error) =>
      typeof error === "string" ? error : "Could not reach the pet service.",
    ),
  );

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const parseJson = (bytes: Uint8Array, unreadable: string) =>
  decodeJson(new TextDecoder().decode(bytes)).pipe(Effect.mapError(() => unreadable));

/**
 * Installs a shared pet by id into `petsDirectory`: the same two files a manual install holds.
 * Everything is checked in memory first, so a bad download never leaves a half-written pet.
 */
export const installPet = Effect.fn("desktop.pet.install")(function* (input: {
  readonly petsDirectory: string;
  readonly id: string;
  readonly origin?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const origin = new URL(input.origin ?? PET_GALLERY_ORIGIN).origin;

  const lookup = yield* request(
    `${origin}/api/pets/${encodeURIComponent(input.id)}/share-data`,
    MAX_LOOKUP_BYTES,
  );
  const body = yield* parseJson(lookup, "The pet service sent an unreadable answer.");
  const listed = (body as { pet?: { id?: unknown; downloadUrl?: unknown } } | null)?.pet;
  if (typeof listed?.id !== "string" || listed.id !== input.id) {
    return yield* Effect.fail("The pet service did not describe that pet.");
  }
  const downloadUrl = new URL(
    typeof listed.downloadUrl === "string"
      ? listed.downloadUrl
      : `/api/pets/${encodeURIComponent(input.id)}/download`,
    `${origin}/`,
  );
  // The package must come from the same service, whatever address the answer names.
  if (downloadUrl.origin !== origin) {
    return yield* Effect.fail("The pet service pointed to a download elsewhere.");
  }

  const archive = yield* request(downloadUrl.toString(), MAX_DOWNLOAD_BYTES);
  const files = yield* Effect.try({
    try: () => readPetArchive(archive),
    catch: (cause) => (cause instanceof Error ? cause.message : "The download is unreadable."),
  });
  const manifestBytes = files.get("pet.json");
  if (manifestBytes === undefined) return yield* Effect.fail("The download has no pet.json.");
  const raw = yield* parseJson(manifestBytes, "The downloaded pet.json is unreadable.");
  const parsed = parsePetManifest(raw, input.id);
  if (!parsed.ok) return yield* Effect.fail(parsed.error);
  const { manifest } = parsed;
  if (manifest.id !== input.id) {
    return yield* Effect.fail("The downloaded pet does not match the requested id.");
  }
  const sprite = files.get(manifest.spritesheetPath);
  if (sprite === undefined) return yield* Effect.fail("The download has no spritesheet.");
  if (sprite.byteLength > PET_MAX_SPRITESHEET_BYTES) {
    return yield* Effect.fail("The spritesheet is too large.");
  }
  const dimensions = readImageDimensions(sprite);
  const problem =
    dimensions === null ? "The spritesheet is not a readable image." : validatePetAtlas(dimensions);
  if (problem !== null) return yield* Effect.fail(problem);

  const directory = path.join(input.petsDirectory, manifest.id);
  yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFile(path.join(directory, "pet.json"), manifestBytes);
    yield* fileSystem.writeFile(path.join(directory, manifest.spritesheetPath), sprite);
  }).pipe(Effect.mapError(() => "Could not save the pet to the pets folder."));
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    directory,
  } satisfies InstalledPet;
});

const MAX_COLLECTION_PETS = 50;
const decodeCollection = Schema.decodeUnknownEffect(
  Schema.Struct({ pets: Schema.Array(Schema.Unknown) }),
);

export interface InstalledCollection {
  readonly installed: ReadonlyArray<InstalledPet>;
  readonly failed: ReadonlyArray<{ readonly id: string; readonly message: string }>;
}

/** Installs every pet of a shared collection, one at a time; one bad pet does not stop the rest. */
export const installCollection = Effect.fn("desktop.pet.installCollection")(function* (input: {
  readonly petsDirectory: string;
  readonly slug: string;
  readonly origin?: string;
}) {
  const origin = new URL(input.origin ?? PET_GALLERY_ORIGIN).origin;
  const lookup = yield* request(
    `${origin}/api/collections/${encodeURIComponent(input.slug)}`,
    MAX_LOOKUP_BYTES,
    "No collection with that name was found.",
  );
  const body = yield* parseJson(lookup, "The pet service sent an unreadable answer.");
  const collection = yield* decodeCollection(body).pipe(
    Effect.mapError(() => "The pet service did not describe that collection."),
  );
  const ids = collection.pets
    .flatMap((pet) => {
      if (typeof pet !== "object" || pet === null || !("id" in pet) || typeof pet.id !== "string")
        return [];
      const reference = parsePetReference(pet.id);
      return reference?.kind === "pet" && reference.id === pet.id ? [reference.id] : [];
    })
    .slice(0, MAX_COLLECTION_PETS);
  if (ids.length === 0) return yield* Effect.fail("That collection has no pets.");
  const installed: InstalledPet[] = [];
  const failed: Array<{ id: string; message: string }> = [];
  for (const id of ids) {
    yield* installPet({
      petsDirectory: input.petsDirectory,
      id,
      ...(input.origin ? { origin: input.origin } : {}),
    }).pipe(
      Effect.map((pet) => void installed.push(pet)),
      Effect.catch((message: string) => Effect.sync(() => void failed.push({ id, message }))),
    );
  }
  return { installed, failed } satisfies InstalledCollection;
});
