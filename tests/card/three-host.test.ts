import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX } from "../../src/card/floorplan-studio-card";
import * as host from "../../src/card/three/host";

// S36.4: the 3D chunk imports no card code, so host.ts holds copies of the card's double-tap numbers. They must stay equal.
describe("three/host.ts copies", () => {
  it("double-tap numbers equal the card's", () => {
    expect(host.DOUBLE_TAP_MS).toBe(DOUBLE_TAP_MS);
    expect(host.DOUBLE_TAP_PX).toBe(DOUBLE_TAP_PX);
  });
});
