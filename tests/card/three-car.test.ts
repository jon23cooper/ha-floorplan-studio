import { describe, expect, it } from "vitest";
import { liveOf } from "../../src/core/live";
import type { Floor } from "../../src/core/schema";
import { loftTriangles, type Triangles } from "../../src/card/three/mesh";
import { isKnownRole, roleStyle } from "../../src/card/three/palette";

// S35.5: the pure parts of the car in 3D: the loft's triangles, the live state of a car piece, and the palette's car roles.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-17T10:00:00Z" });
const floor = (furniture: unknown[]): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"],
  rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [],
}) as unknown as Floor;
const car = (extra: Record<string, unknown> = {}) => ({ id: "c", symbol: "car", x: 300, y: 250, rot: 0, w: 470, h: 182, ...extra });
const live = (f: Floor, state: Record<string, unknown>) => liveOf(f, { scale: 1, state: state as never }, 0);

describe("loftTriangles", () => {
  const base: [number, number][] = [[0, 0], [100, 0], [100, 60], [0, 60]], top: [number, number][] = [[20, 10], [80, 10], [80, 50], [20, 50]];
  const tris = (b: unknown, t: unknown, z0 = 0, z1 = 30) => { const out: Triangles = { position: [], normal: [] }; const ok = loftTriangles(b, t, z0, z1, out); return { ok, out }; };

  it("makes two lids and two triangles a side; three.js' frame (x, z up as y, plan y as z)", () => {
    const { ok, out } = tris(base, top);
    expect(ok).toBe(true);
    expect(out.position.length / 9).toBe(2 + 2 + 4 * 2);
    const ys = out.position.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(30);
  });
  it("every triangle faces out of the loft, whichever way the rings are wound", () => {
    for (const [b, t] of [[base, top], [[...base].reverse(), [...top].reverse()]] as const) {
      const { out } = tris(b, t), c = [50, 15, 30];
      for (let i = 0; i < out.position.length; i += 9) {
        const p = out.position.slice(i, i + 9), n = out.normal.slice(i, i + 3);
        const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2], "winding agrees with the normal").toBeGreaterThan(0);
        const mid = [(p[0] + p[3] + p[6]) / 3, (p[1] + p[4] + p[7]) / 3, (p[2] + p[5] + p[8]) / 3];
        expect((mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1] + (mid[2] - c[2]) * n[2], "the normal points away from the middle").toBeGreaterThan(0);
      }
    }
  });
  it("junk adds nothing and never throws", () => {
    for (const [b, t, z0, z1] of [[null, top, 0, 1], [base, null, 0, 1], [base, top.slice(1), 0, 1], [base.slice(0, 2), top.slice(0, 2), 0, 1], [base, top, 5, 5], [base, top, NaN, 1], [[[0, 0], [NaN, 1], [1, 1]], [[0, 0], [1, 1], [2, 2]], 0, 1], [[[0, 0], [1e12, 0], [1, 1]], [[0, 0], [1, 0], [1, 1]], 0, 1]] as [unknown, unknown, number, number][]) {
      expect(() => tris(b, t, z0, z1)).not.toThrow();
      expect(tris(b, t, z0, z1).ok).toBe(false);
    }
  });
});

describe("live: a car piece", () => {
  const f = floor([car({ entity: "device_tracker.car", attached: ["sensor.car_charging", "sensor.car_battery", "lock.car"] }), car({ symbol: "table" }), car({ entity: undefined })]);
  const STATES = (o: Record<string, unknown> = {}) => ({
    "device_tracker.car": st("home"), "sensor.car_charging": st("stopped"), "sensor.car_battery": st("78", { device_class: "battery", unit_of_measurement: "%" }), "lock.car": st("locked"), ...o,
  });
  it("home, idle and locked", () => {
    expect(live(f, STATES()).pieces[0]).toEqual({ on: false, away: false, charging: false, alert: false, level: 78 });
  });
  it("away (not_home and a zone) is away; charging (the enum) and an unlocked lock are their own flags", () => {
    expect(live(f, STATES({ "device_tracker.car": st("not_home") })).pieces[0]!.away).toBe(true);
    expect(live(f, STATES({ "device_tracker.car": st("Work") })).pieces[0]!.away).toBe(true);
    const c = live(f, STATES({ "sensor.car_charging": st("charging") })).pieces[0]!;
    expect(c).toMatchObject({ on: true, charging: true, away: false, alert: false });
    expect(live(f, STATES({ "lock.car": st("unlocked") })).pieces[0]).toMatchObject({ alert: true, charging: false });
  });
  it("review finding 6: a dead main entity is gone, as on the plan; a live one, and a dead tracker that charges, are not", () => {
    expect(live(f, STATES({ "device_tracker.car": st("unavailable") })).pieces[0]).toMatchObject({ gone: true });
    expect(live(f, STATES({ "device_tracker.car": st("unknown") })).pieces[0]).toMatchObject({ gone: true });
    expect(live(f, STATES()).pieces[0]).not.toHaveProperty("gone");
    expect(live(f, STATES({ "device_tracker.car": st("unavailable"), "sensor.car_charging": st("charging") })).pieces[0]).not.toHaveProperty("gone");
  });
  it("a car with no tracker is never away; a table, or a car with nothing linked, has no state of its own", () => {
    const g = floor([car({ entity: "sensor.car_charging" })]);
    expect(live(g, { "sensor.car_charging": st("charging") }).pieces[0]).toMatchObject({ away: false, charging: true });
    expect(live(f, STATES()).pieces.slice(1)).toEqual([null, null]);
  });
  it("junk states never throw", () => {
    for (const bad of [null, 5, "x", { "device_tracker.car": null }, { "device_tracker.car": { state: 5 } }]) expect(() => live(f, bad as never)).not.toThrow();
  });
});

describe("palette: the car's roles", () => {
  it("names all five; the glass and tyres are near-black whatever the theme", () => {
    for (const r of ["car-body", "car-glass", "car-tyre", "car-trim", "car-charge"]) expect(isKnownRole(r), r).toBe(true);
    expect(roleStyle("car-glass").css).toContain("black");
    expect(roleStyle("car-tyre").css).toContain("black");
    expect(roleStyle("car-charge").css).toContain("--fp-dev-car");
    expect(roleStyle("car-body").css).toContain("--fp-furniture");
  });
});

describe("the car's wheels (review finding 11)", () => {
  it("each tyre's outer face stands at least a centimetre inside the body side: 0.3 cm was within the depth buffer's noise and drew seam lines", async () => {
    const { CAR_WHEEL_INSET } = await import("../../src/core/scene-build");
    expect(CAR_WHEEL_INSET).toBeGreaterThanOrEqual(1);
  });
});
