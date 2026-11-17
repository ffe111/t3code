// A T3 Pet package is a folder with pet.json and a spritesheet atlas: 8 columns of
// 192x208 cells, 9 animation rows, and an optional v2 tail of two look-direction rows.

export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
const PET_ATLAS_WIDTH = 1536;
const PET_ATLAS_HEIGHTS = [1872, 2288] as const;
export const PET_MAX_SPRITESHEET_BYTES = 8 * 1024 * 1024;

/** Frame durations in ms, one entry per used column. Row order is the atlas order. */
export const PET_ANIMATIONS = {
  idle: [280, 110, 110, 140, 140, 320],
  "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
  "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280],
  jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220],
  review: [150, 150, 150, 150, 150, 280],
} as const;

export type PetAnimation = keyof typeof PET_ANIMATIONS;

export const PET_ANIMATION_ROWS = Object.keys(PET_ANIMATIONS) as readonly PetAnimation[];

export interface PetManifest {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spritesheetPath: string;
}

export type PetManifestResult =
  | { readonly ok: true; readonly manifest: PetManifest }
  | { readonly ok: false; readonly error: string };

const PET_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SPRITESHEET_FILE = /^[^/\\:*?"<>|]+\.(webp|png)$/i;

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : fallback;
}

/** `folderName` stands in for a missing id, as community packages are often renamed. */
export function parsePetManifest(raw: unknown, folderName: string): PetManifestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "pet.json must be an object." };
  }
  const value = raw as Record<string, unknown>;
  const spritesheetPath = value.spritesheetPath;
  if (typeof spritesheetPath !== "string" || !SPRITESHEET_FILE.test(spritesheetPath)) {
    return {
      ok: false,
      error: "spritesheetPath must name a .webp or .png file in the pet folder.",
    };
  }
  const id = text(value.id, folderName, 64);
  if (!PET_ID.test(id)) return { ok: false, error: "The pet id has unsupported characters." };
  return {
    ok: true,
    manifest: {
      id,
      displayName: text(value.displayName, id, 80),
      description: text(value.description, "", 280),
      spritesheetPath,
    },
  };
}

/**
 * Only the first nine rows are drawn, so v1 (8x9) and v2 (8x11) atlases both work and
 * the declared version does not need to agree with the image.
 */
export function validatePetAtlas(dimensions: {
  readonly width: number;
  readonly height: number;
}): string | null {
  if (
    dimensions.width !== PET_ATLAS_WIDTH ||
    !(PET_ATLAS_HEIGHTS as readonly number[]).includes(dimensions.height)
  ) {
    return `The spritesheet is ${dimensions.width}x${dimensions.height}; expected ${PET_ATLAS_WIDTH}x${PET_ATLAS_HEIGHTS.join(" or ")}.`;
  }
  return null;
}
