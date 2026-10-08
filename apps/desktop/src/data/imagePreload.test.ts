import { describe, expect, it } from "vitest";
import { proximityOrder } from "./imagePreload";

describe("proximityOrder", () => {
  it("goes outward from the open frame, next before previous", () => {
    expect(proximityOrder(2, 6)).toEqual([3, 1, 4, 0, 5]);
  });
  it("wraps around the ends and never repeats or includes the open frame", () => {
    const order = proximityOrder(0, 5);
    expect(order).toEqual([1, 4, 2, 3]);
    expect(new Set(order).size).toBe(order.length);
    expect(order).not.toContain(0);
  });
  it("copes with tiny sets", () => {
    expect(proximityOrder(0, 1)).toEqual([]);
    expect(proximityOrder(0, 2)).toEqual([1]);
  });
});
