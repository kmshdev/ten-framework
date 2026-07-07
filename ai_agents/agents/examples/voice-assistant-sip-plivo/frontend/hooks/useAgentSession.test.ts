import { describe, expect, test } from "vitest";
import { parseTs } from "./useAgentSession";

describe("parseTs", () => {
  test("parses a valid ISO timestamp to epoch ms", () => {
    const ms = parseTs("2024-01-01T00:00:00.000Z");
    expect(ms).toBe(Date.parse("2024-01-01T00:00:00.000Z"));
  });

  test("returns 0 for an empty string", () => {
    expect(parseTs("")).toBe(0);
  });

  test("returns 0 for garbage input instead of NaN", () => {
    expect(parseTs("not-a-date")).toBe(0);
    expect(Number.isNaN(parseTs("not-a-date"))).toBe(false);
  });

  test("orders two timestamps correctly", () => {
    const earlier = parseTs("2024-01-01T00:00:00.000Z");
    const later = parseTs("2024-01-02T00:00:00.000Z");
    expect(later).toBeGreaterThan(earlier);
  });
});
