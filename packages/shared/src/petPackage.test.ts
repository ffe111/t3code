import { describe, expect, it } from "vite-plus/test";

import {
  PET_ANIMATIONS,
  PET_ANIMATION_ROWS,
  parsePetManifest,
  parsePetReference,
  petLookCell,
  validatePetAtlas,
} from "./petPackage.ts";

describe("parsePetManifest", () => {
  it("reads a community package and falls back to the folder name for a missing id", () => {
    expect(
      parsePetManifest(
        {
          id: "bravo",
          displayName: "Bravo",
          description: "Fan-made",
          spriteVersionNumber: 2,
          spritesheetPath: "spritesheet.webp",
        },
        "folder",
      ),
    ).toEqual({
      ok: true,
      manifest: {
        id: "bravo",
        displayName: "Bravo",
        description: "Fan-made",
        spritesheetPath: "spritesheet.webp",
      },
    });
    expect(parsePetManifest({ spritesheetPath: "sheet.png" }, "my-pet")).toMatchObject({
      ok: true,
      manifest: { id: "my-pet", displayName: "my-pet" },
    });
  });

  it.each([
    ["not an object", "oops"],
    ["an array", []],
    ["no spritesheet", { id: "a" }],
    ["a path outside the folder", { spritesheetPath: "../escape.webp" }],
    ["a nested path", { spritesheetPath: "sub/sheet.webp" }],
    ["an absolute path", { spritesheetPath: "C:\\sheet.webp" }],
    ["an unsupported image type", { spritesheetPath: "sheet.gif" }],
    ["an id with separators", { id: "../x", spritesheetPath: "sheet.webp" }],
  ])("rejects %s", (_name, raw) => {
    expect(parsePetManifest(raw, "folder")).toMatchObject({ ok: false });
  });
});

describe("validatePetAtlas", () => {
  it.each([
    [{ width: 1536, height: 1872 }, null],
    [{ width: 1536, height: 2288 }, null],
    [{ width: 1536, height: 1800 }, expect.stringContaining("expected 1536x1872 or 2288")],
    [{ width: 768, height: 936 }, expect.stringContaining("expected")],
  ])("checks %j", (dimensions, expected) => {
    expect(validatePetAtlas(dimensions)).toEqual(expected);
  });
});

describe("animations", () => {
  it("keeps the atlas row order and per-row frame counts", () => {
    expect(PET_ANIMATION_ROWS).toEqual([
      "idle",
      "running-right",
      "running-left",
      "waving",
      "jumping",
      "failed",
      "waiting",
      "running",
      "review",
    ]);
    expect(PET_ANIMATION_ROWS.map((row) => PET_ANIMATIONS[row].length)).toEqual([
      6, 8, 8, 4, 5, 8, 6, 6, 6,
    ]);
  });
});

describe("parsePetReference", () => {
  it.each([
    ["wilson-original-v2", { kind: "pet", id: "wilson-original-v2" }],
    ["  Wilson-Original-V2  ", { kind: "pet", id: "wilson-original-v2" }],
    ["npx some-tool add wilson-original-v2", { kind: "pet", id: "wilson-original-v2" }],
    ["pnpm dlx some-tool add tiny-dino", { kind: "pet", id: "tiny-dino" }],
    ["npx some-tool add-collection cats", { kind: "collection", id: "cats" }],
    ["https://example.com/pets/tiny-dino", { kind: "pet", id: "tiny-dino" }],
    ["https://example.com/pets/tiny-dino/?utm=1", { kind: "pet", id: "tiny-dino" }],
    ["https://example.com/collections/cats", { kind: "collection", id: "cats" }],
  ])("finds the reference in %j", (input, expected) => {
    expect(parsePetReference(input)).toEqual(expected);
  });

  it.each([
    "",
    "   ",
    "two words",
    "npx tool remove tiny-dino",
    "npx tool add",
    "npx tool add-collection",
    "not an id!",
    "https://example.com/",
    "https://",
    "Tiny_Dino",
    "a".repeat(400),
  ])("rejects %j", (input) => {
    expect(parsePetReference(input)).toBeNull();
  });
});

describe("petLookCell", () => {
  it.each([
    [0, -10, { row: 9, column: 0 }],
    [10, -10, { row: 9, column: 2 }],
    [10, 0, { row: 9, column: 4 }],
    [10, 10, { row: 9, column: 6 }],
    [0, 10, { row: 10, column: 0 }],
    [-10, 10, { row: 10, column: 2 }],
    [-10, 0, { row: 10, column: 4 }],
    [-10, -10, { row: 10, column: 6 }],
    // Just left of straight up still rounds up to the first pose, not past the last.
    [-1, -10, { row: 9, column: 0 }],
    [3, -10, { row: 9, column: 1 }],
  ])("looks toward (%f, %f)", (dx, dy, expected) => {
    expect(petLookCell(dx, dy, 2)).toEqual(expected);
  });

  it("keeps the usual pose near the centre", () => {
    expect(petLookCell(1, 1, 5)).toBeNull();
    expect(petLookCell(0, 0, 0.5)).toBeNull();
  });
});
