import { describe, expect, it } from "vite-plus/test";
import { usageWidgetBounds } from "./usageWidgetBounds.ts";

describe("usageWidgetBounds", () => {
  it.each([
    {
      position: { x: -1400, y: 30 },
      area: { x: -1920, y: 0, width: 1920, height: 1040 },
      size: { width: 300, height: 400 },
      expected: { x: -1400, y: 30, width: 300, height: 400 },
    },
    {
      position: { x: 2800, y: 1200 },
      area: { x: 0, y: 40, width: 1280, height: 680 },
      size: { width: 300, height: 400 },
      expected: { x: 980, y: 320, width: 300, height: 400 },
    },
    {
      position: null,
      area: { x: 0, y: 0, width: 800, height: 600 },
      size: { width: 2000, height: 1200 },
      expected: { x: 0, y: 0, width: 800, height: 600 },
    },
  ])("keeps the widget reachable for $position on $area", ({ position, area, size, expected }) => {
    expect(usageWidgetBounds(position, size, area)).toEqual(expected);
  });
});
