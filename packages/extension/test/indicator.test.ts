import { describe, expect, it } from "vitest";
import { contrast, controllerLabel, indicatorColors, RANDOM_GROUP_COLORS } from "../src/background/indicator";

describe("indicator colors", () => {
  it("only offers random colors that white text is readable on", () => {
    expect([...RANDOM_GROUP_COLORS].sort()).toEqual(["blue", "cyan", "green", "grey", "pink", "purple", "red"]);
  });

  it("always pairs a background with readable text", () => {
    for (const color of ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] as const) {
      const { background, text } = indicatorColors(color);
      expect(contrast(background, text), color).toBeGreaterThanOrEqual(3);
    }
    expect(indicatorColors("yellow").text).toBe("#202124");
    expect(indicatorColors(undefined).background).toBe("#1a73e8");
  });

  it("formats client names", () => {
    expect(controllerLabel("claude-code")).toBe("Claude Code");
    expect(controllerLabel(undefined)).toBe("an AI agent");
  });
});
