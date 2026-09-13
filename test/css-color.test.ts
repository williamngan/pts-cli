import { describe, expect, it } from "vitest";

import { isCSSColor } from "../src/cssColor.js";

describe("CSS color validation", () => {
  it.each([
    "red",
    "RED",
    "RebeccaPurple",
    "transparent",
    "#fff",
    "#FFFF",
    "#10131a",
    "#ff000080",
    "rgb(255,0,0)",
    "rgb(255, 0, 0)",
    "rgba(0,0,255,0.5)",
    "rgba(0, 0, 255, 50%)",
    "rgb(255 0 0)",
    "rgb(255 0 0 / 50%)",
    "hsl(120,50%,50%)",
    "hsl(120deg 50% 50%)",
    "hsla(120, 50%, 50%, .5)",
    "hwb(120 10% 10%)",
    "HSL(0.5turn 100% 50% / 1)",
  ])("accepts %s", (value) => {
    expect(isCSSColor(value)).toBe(true);
  });

  it.each([
    "",
    " ",
    "notacolor",
    "ff0000",
    "#ff",
    "#12345",
    "#ggg",
    " #fff ",
    "red red",
    "0xff0000",
    "rgb()",
    "rgb(255,0)",
    "rgb(255,0,0,0,0)",
    "rgb(255 0 0 50%)",
    "rgb(a,b,c)",
    "currentColor",
    "lab(50% 20 30)",
    "oklch(0.5 0.1 120)",
    "color(srgb 1 0 0)",
    "url(#gradient)",
  ])("rejects %j", (value) => {
    expect(isCSSColor(value)).toBe(false);
  });
});
