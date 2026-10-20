import { describe, it, expect } from "vitest";
import type { Floor } from "../../src/core/schema";
import { renderFloor } from "../../src/core/render";
import { liveOf } from "../../src/core/live";

// The card passes `formatState` (HA's own display text) to the 2D plan and, through setLive, to the 3D view.
// The 2D plan prints it (render.ts); the 3D overlay must print the same text. Reply shape: render.ts RenderOpts.formatState.
const sq = (s: number): [number, number][] => [[0, 0], [s, 0], [s, s], [0, s]];
const f = { title: "T", outline: sq(2000), rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [], devices: [{ id: "t", type: "temp", entity: "sensor.t", x: 300, y: 300 }] } as unknown as Floor;
const state = { "sensor.t": { state: "21.456789", attributes: { unit_of_measurement: "°C" } } };
const NOW = Date.parse("2026-10-08T10:00:00Z");

describe("3D sensor value uses the card's formatter, as 2D does", () => {
  const formatState = (e: string) => (e === "sensor.t" ? "21,46 Celsius!" : undefined); // not the raw state, not a rounding
  it("2D and 3D print the formatter's text", () => {
    expect(renderFloor(f, { scale: 1, state, formatState })).toContain(">21,46 Celsius!<");
    expect(liveOf(f, { scale: 1, state, formatState }, NOW).devices[0]?.value).toBe("21,46 Celsius!");
  });
  it("without a formatter or an answer from it, the raw state and unit as before", () => {
    const raw = "21.456789 °C";
    expect(liveOf(f, { scale: 1, state }, NOW).devices[0]?.value).toBe(raw);
    expect(liveOf(f, { scale: 1, state, formatState: () => undefined }, NOW).devices[0]?.value).toBe(raw);
  });
  it("a reading that is not a number still reads as a dash", () => {
    const bad = { "sensor.t": { state: "unavailable", attributes: {} } };
    expect(liveOf(f, { scale: 1, state: bad, formatState }, NOW).devices[0]?.value).toBe("–");
  });
});
