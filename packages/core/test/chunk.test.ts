import { describe, expect, it } from "vitest";
import { chunk } from "../src/chunk.js";

describe("chunk", () => {
  it("splits into slices of at most `size`", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns no slices for an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});
