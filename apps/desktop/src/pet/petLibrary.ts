import { readImageDimensions } from "@t3tools/shared/imageDimensions";
import {
  PET_MAX_SPRITESHEET_BYTES,
  parsePetManifest,
  validatePetAtlas,
} from "@t3tools/shared/petPackage";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { DEFAULT_PET_SPRITE_BASE64 } from "./defaultPetSprite.ts";

const BUILT_IN_PET_ID = "t3";
const MANIFEST_MAX_BYTES = 64 * 1024;

export interface PetInfo {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly builtIn: boolean;
  readonly directory: string | null;
  readonly spritesheetPath: string | null;
}

export interface PetLoadFailure {
  readonly folder: string;
  readonly error: string;
}

export const BUILT_IN_PET: PetInfo = {
  id: BUILT_IN_PET_ID,
  displayName: "T3",
  description: "The built-in T3 Pet.",
  builtIn: true,
  directory: null,
  spritesheetPath: null,
};

const MIME = { webp: "image/webp", png: "image/png" } as const;

/** Installed pets are the subfolders of `petsDirectory`; a bad package is reported, never fatal. */
export const scanPets = Effect.fn("desktop.pet.scan")(function* (petsDirectory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folders = yield* fileSystem
    .readDirectory(petsDirectory)
    .pipe(Effect.orElseSucceed(() => [] as string[]));
  const pets: PetInfo[] = [BUILT_IN_PET];
  const failures: PetLoadFailure[] = [];
  for (const folder of [...folders].sort()) {
    const directory = path.join(petsDirectory, folder);
    const result = yield* readPetPackage(directory, folder).pipe(
      Effect.map((info) => ({ ok: true as const, info })),
      Effect.catch((error: string) => Effect.succeed({ ok: false as const, error })),
    );
    if (!result.ok) {
      // A stray file next to the pet folders is not a broken pet.
      const isFolder = yield* fileSystem.stat(directory).pipe(
        Effect.map((stat) => stat.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );
      if (isFolder) failures.push({ folder, error: result.error });
      continue;
    }
    // The first folder wins a duplicate id, and the built-in id is reserved.
    if (!pets.some((pet) => pet.id === result.info.id)) pets.push(result.info);
  }
  return { pets, failures };
});

const readPetPackage = Effect.fn("desktop.pet.readPackage")(function* (
  directory: string,
  folder: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fail = (message: string) => Effect.fail(message);
  const manifestPath = path.join(directory, "pet.json");
  const manifestStat = yield* fileSystem.stat(manifestPath).pipe(Effect.orElseSucceed(() => null));
  if (manifestStat === null) return yield* fail("pet.json is missing.");
  if (Number(manifestStat.size) > MANIFEST_MAX_BYTES) return yield* fail("pet.json is too large.");
  const raw = yield* fileSystem.readFileString(manifestPath).pipe(
    Effect.map((contents): unknown => {
      try {
        return JSON.parse(contents);
      } catch {
        return undefined;
      }
    }),
    Effect.orElseSucceed(() => undefined),
  );
  if (raw === undefined) return yield* fail("pet.json could not be read.");
  const parsed = parsePetManifest(raw, folder);
  if (!parsed.ok) return yield* fail(parsed.error);
  const { manifest } = parsed;
  const problem = yield* checkSpritesheet(path.join(directory, manifest.spritesheetPath));
  if (problem !== null) return yield* fail(problem);
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    description: manifest.description,
    builtIn: false,
    directory,
    spritesheetPath: manifest.spritesheetPath,
  } satisfies PetInfo;
});

const checkSpritesheet = Effect.fn("desktop.pet.checkSpritesheet")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const stat = yield* fileSystem.stat(file).pipe(Effect.orElseSucceed(() => null));
  if (stat === null || stat.type !== "File") return "The spritesheet file is missing.";
  if (Number(stat.size) > PET_MAX_SPRITESHEET_BYTES) return "The spritesheet is too large.";
  const bytes = yield* fileSystem.readFile(file).pipe(Effect.orElseSucceed(() => null));
  if (bytes === null) return "The spritesheet could not be read.";
  const dimensions = readImageDimensions(bytes);
  if (dimensions === null) return "The spritesheet is not a readable image.";
  return validatePetAtlas(dimensions);
});

/** A data URL keeps the sandboxed pet window from needing any file or protocol access. */
export const loadPetSprite = Effect.fn("desktop.pet.loadSprite")(function* (pet: PetInfo) {
  if (pet.builtIn || pet.directory === null || pet.spritesheetPath === null) {
    return `data:image/webp;base64,${DEFAULT_PET_SPRITE_BASE64}`;
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(pet.directory, pet.spritesheetPath);
  const bytes = yield* fileSystem.readFile(file);
  const type = file.toLowerCase().endsWith(".png") ? MIME.png : MIME.webp;
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
});
