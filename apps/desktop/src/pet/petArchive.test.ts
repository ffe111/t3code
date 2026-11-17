import { describe, expect, it } from "vite-plus/test";

import { readPetArchive } from "./petArchive.ts";
import { makeZip } from "./testZip.ts";

const text = (value: string) => new TextEncoder().encode(value);

describe("readPetArchive", () => {
  it.each([0, 8] as const)("reads stored and deflated top-level files (method %i)", (method) => {
    const files = readPetArchive(
      makeZip({ "pet.json": text('{"id":"a"}'), "spritesheet.webp": text("sprite") }, method),
    );
    expect([...files.keys()]).toEqual(["pet.json", "spritesheet.webp"]);
    expect(new TextDecoder().decode(files.get("pet.json"))).toBe('{"id":"a"}');
  });

  it("skips folders and nested or escaping paths", () => {
    const files = readPetArchive(
      makeZip({
        "dir/": text(""),
        "dir/pet.json": text("nested"),
        "../pet.json": text("escape"),
        "back\\slash.json": text("windows"),
        "pet.json": text("top"),
      }),
    );
    expect([...files.keys()]).toEqual(["pet.json"]);
  });

  it("refuses what is not, or cannot safely be, an archive", () => {
    expect(() => readPetArchive(text("<html>not a zip</html>"))).toThrow("not a zip");
    const zip = makeZip({ "pet.json": text("{}") });
    expect(() => readPetArchive(zip.subarray(0, zip.length - 30))).toThrow();
    // A small archive that expands past the cap is refused before it is inflated.
    const bomb = makeZip({ "spritesheet.webp": new Uint8Array(20 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(100 * 1024);
    expect(() => readPetArchive(bomb)).toThrow("too large");
  });
});
