import { describe, it, expect } from "vitest";
import { buildScene } from "../../src/core/scene";
import type { Floor } from "../../src/core/schema";
import { placePoint } from "../../src/core/floor-stack";

// S27.7: `SceneOpts.shift` moves every solid in plan x and y, so a floor below can be drawn at its place in the house.
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const f = floor({
  rooms: [{ name: "Hall", kind: "room", pts: [[10, 10], [300, 10], [300, 200], [10, 200]] } as never],
  furniture: [{ id: "f", symbol: "cabinet", x: 300, y: 250, rot: 0, w: 60, h: 40 }],
  devices: [{ id: "d", type: "light", entity: "light.x", x: 100, y: 120 } as never],
});
const pts = (s: ReturnType<typeof buildScene>["solids"][number]): number[][] => (s.shape.type === "point" ? [s.shape.at] : s.shape.base);

describe("scene: shift (S27.7)", () => {
  it("moves every point of every solid by [dx, dy] and leaves z alone", () => {
    const a = buildScene(f), b = buildScene(f, { shift: [137.4, -61.7], elevation: -275 });
    expect(b.solids.length).toBe(a.solids.length);
    expect(b.solids.length).toBeGreaterThan(5);
    a.solids.forEach((s, i) => {
      const t = b.solids[i];
      pts(s).forEach((p, k) => { expect(pts(t)[k][0]).toBeCloseTo(p[0] + 137.4, 6); expect(pts(t)[k][1]).toBeCloseTo(p[1] - 61.7, 6); });
      if (s.shape.type === "prism" && t.shape.type === "prism") { expect(t.shape.z0).toBeCloseTo(s.shape.z0 - 275, 6); expect(t.shape.z1).toBeCloseTo(s.shape.z1 - 275, 6); }
    });
  });
  it("moves the bounds the same way", () => {
    const a = buildScene(f), b = buildScene(f, { shift: [-50, 20] });
    expect(b.bounds.min).toEqual([a.bounds.min[0] - 50, a.bounds.min[1] + 20, a.bounds.min[2]]);
    expect(b.bounds.max).toEqual([a.bounds.max[0] - 50, a.bounds.max[1] + 20, a.bounds.max[2]]);
  });
  it("junk shift means none, and never throws", () => {
    const a = buildScene(f);
    for (const junk of [undefined, null, "1,2", [1], [1, 2, 3], [NaN, 0], [0, Infinity], [1, "2"], {}, 5] as unknown[]) {
      expect(() => buildScene(f, { shift: junk as never })).not.toThrow();
      expect(buildScene(f, { shift: junk as never })).toEqual(a);
    }
  });
});

// S29.4: `SceneOpts.turn` turns every solid about the origin, degrees clockwise on screen, before `shift`: `placePoint({ turn, shift })`.
// Design note (which builders read `ref` and not the points). The turn is applied at `add`, the one choke point every solid passes, to the
// base, the holes and the point. What the solids also carry in `ref` and what that means under a turn:
//  - `ref.crown.rot`: a tree's own turn, read by the crown matrix and the contact shadow. It is turned by `turn`, so the ellipse axis follows.
//    The crown's centre is the centroid of the trunk's base, which has already moved, and `ref.size` is the tree's own w x h: both stay.
//  - `ref.faces`: the unit normals of a wall, read by the viewer to lower the walls that face the camera. They are directions, not points: turned
//    by `turn`, never shifted. Left alone, a floor below turned 4 degrees would cut its walls against the wrong side.
//  - `ref.size`, `index`, `room`, `poly`, ids: not geometry in the plan's frame. Unchanged.
const place = { turn: 4, shift: [83, -41] as [number, number] };
const tf = floor({
  rooms: [{ name: "Hall", kind: "room", pts: [[10, 10], [300, 10], [300, 200], [10, 200]] } as never, { name: "Study", kind: "room", pts: [[300, 10], [590, 10], [590, 200], [300, 200]] } as never],
  walls: [{ id: "w1", a: [100, 300], b: [450, 360], kind: "wall" } as never],
  stairs: [{ id: "s", name: "S", pts: [[100, 100], [180, 100], [180, 260], [100, 260]], shape: "straight", steps: 4, rot: 0, direction: "down" }] as never,
  doors: [{ id: "d1", a: [300, 50], b: [300, 120], kind: "door" } as never],
  furniture: [{ id: "t", symbol: "tree", x: 450, y: 300, rot: 33, w: 120, h: 70 }, { id: "c", symbol: "cabinet", x: 300, y: 250, rot: 0, w: 60, h: 40 }],
  devices: [{ id: "d", type: "light", entity: "light.x", x: 100, y: 120 } as never],
});
const all = (sc: ReturnType<typeof buildScene>) => sc.solids.map((s) => (s.shape.type === "point" ? [s.shape.at] : s.shape.base));

describe("scene: turn (S29.4)", () => {
  const stored = buildScene(tf), turned = buildScene(tf, { turn: place.turn, shift: place.shift, elevation: -295 });
  it("puts every base point, every point solid and every hole at placePoint of the stored one, within 1e-6", () => {
    expect(turned.solids.length).toBe(stored.solids.length);
    expect(turned.solids.length).toBeGreaterThan(20);
    all(stored).forEach((ps, i) => ps.forEach((p, k) => {
      const want = placePoint(place, p as [number, number]), got = all(turned)[i]![k]!;
      expect(got[0], `solid ${i} point ${k} x`).toBeCloseTo(want[0], 6);
      expect(got[1], `solid ${i} point ${k} y`).toBeCloseTo(want[1], 6);
    }));
    let holes = 0;
    stored.solids.forEach((s, i) => {
      const a = s.shape.type === "prism" ? s.shape.holes : undefined, b = turned.solids[i]!.shape;
      expect(!!a, `holes of solid ${i}`).toBe(b.type === "prism" && !!b.holes);
      a?.forEach((h, j) => h.forEach((p, k) => { holes++; const want = placePoint(place, p), got = (b as { holes: number[][][] }).holes[j]![k]!; expect(got[0]).toBeCloseTo(want[0], 6); expect(got[1]).toBeCloseTo(want[1], 6); }));
    });
    expect(holes, "the stairwell hole is turned too").toBeGreaterThan(4);
  });
  it("names the slab corner, a wall end, a stair step corner and a crown centre", () => {
    const at = (sc: typeof stored, pick: (s: (typeof stored)["solids"][number]) => boolean) => sc.solids.filter(pick).flatMap((s) => (s.shape.type === "point" ? [s.shape.at] : s.shape.base));
    const slab = at(turned, (s) => s.kind === "floor")[1]!; // [600, 0]
    expect(slab[0]).toBeCloseTo(600 * Math.cos((4 * Math.PI) / 180) + 83, 6);
    expect(slab[1]).toBeCloseTo(600 * Math.sin((4 * Math.PI) / 180) - 41, 6);
    const step = turned.solids.find((s) => s.kind === "stair")!, step0 = stored.solids.find((s) => s.kind === "stair")!;
    expect(step.shape.type === "prism" && step.shape.base[0]![0]).toBeCloseTo(placePoint(place, (step0.shape as { base: [number, number][] }).base[0]!)[0], 6);
    const tree = turned.solids.find((s) => s.ref.crown)!, tree0 = stored.solids.find((s) => s.ref.crown)!;
    const c = (s: typeof tree) => { const b = (s.shape as { base: number[][] }).base; return [b.reduce((a, q) => a + q[0]!, 0) / b.length, b.reduce((a, q) => a + q[1]!, 0) / b.length]; };
    expect(c(tree)[0]).toBeCloseTo(placePoint(place, c(tree0) as [number, number])[0], 6);
    expect(c(tree)[1]).toBeCloseTo(placePoint(place, c(tree0) as [number, number])[1], 6);
  });
  it("turns a crown's own axis with the floor, and keeps its size and its lifted z range", () => {
    const t = turned.solids.find((s) => s.ref.crown)!, t0 = stored.solids.find((s) => s.ref.crown)!;
    expect(t0.ref.crown!.rot).toBe(33);
    expect(t.ref.crown!.rot).toBeCloseTo(37, 6); // 33 + 4, not 33 and not 29
    expect(t.ref.size).toEqual(t0.ref.size);
    expect(t.ref.crown!.z0).toBeCloseTo(t0.ref.crown!.z0 - 295, 6);
    expect(t.ref.crown!.z1).toBeCloseTo(t0.ref.crown!.z1 - 295, 6);
  });
  it("turns the wall normals (directions: no shift), so the viewer lowers the right side", () => {
    const walls = stored.solids.filter((s) => s.kind === "wall" && s.ref.faces?.length);
    expect(walls.length).toBeGreaterThan(3);
    walls.forEach((w) => {
      const t = turned.solids.find((x) => x.id === w.id)!;
      w.ref.faces!.forEach((n, k) => {
        const want = placePoint({ turn: place.turn, shift: [0, 0] }, n);
        expect(t.ref.faces![k]![0], `${w.id} normal ${k}`).toBeCloseTo(want[0], 9);
        expect(t.ref.faces![k]![1]).toBeCloseTo(want[1], 9);
      });
    });
    expect(stored.solids.find((s) => s.kind === "wall")!.ref.faces).toEqual(buildScene(tf, { turn: 0, shift: [5, 5] }).solids.find((s) => s.kind === "wall")!.ref.faces);
  });
  it("moves the bounds with it", () => {
    const flat = buildScene(tf, { elevation: -295 });
    const xs: number[] = [], ys: number[] = [];
    for (const ps of all(flat)) for (const p of ps) { const q = placePoint(place, p as [number, number]); xs.push(q[0]); ys.push(q[1]); }
    expect(turned.bounds.min[0]).toBeCloseTo(Math.min(...xs), 6);
    expect(turned.bounds.max[0]).toBeCloseTo(Math.max(...xs), 6);
    expect(turned.bounds.min[1]).toBeCloseTo(Math.min(...ys), 6);
    expect(turned.bounds.max[1]).toBeCloseTo(Math.max(...ys), 6);
  });
  it("a turn of 0 or none is what it was, and junk turn reads as none, never a throw", () => {
    expect(buildScene(tf, { turn: 0, shift: place.shift })).toEqual(buildScene(tf, { shift: place.shift }));
    for (const junk of [undefined, null, "4", [4], NaN, Infinity, -Infinity, {}, 361, -1e9] as unknown[]) {
      expect(() => buildScene(tf, { turn: junk as never, shift: place.shift }), String(junk)).not.toThrow();
      expect(buildScene(tf, { turn: junk as never, shift: place.shift }), String(junk)).toEqual(buildScene(tf, { shift: place.shift }));
    }
  });
  it("turns about the origin and then shifts, in that order (a swap fails)", () => {
    const a = buildScene(tf, { turn: 4, shift: [83, -41] }), b = buildScene(tf, { shift: [83, -41] });
    expect((a.solids[0]!.shape as { base: number[][] }).base[1]).not.toEqual((b.solids[0]!.shape as { base: number[][] }).base[1]);
    const p = (a.solids[0]!.shape as { base: number[][] }).base[0]!, q = (stored.solids[0]!.shape as { base: number[][] }).base[0]!;
    // the shift is not turned: stored (0, 0) lands exactly on the shift
    expect(q).toEqual([0, 0]);
    expect(p[0]).toBeCloseTo(83, 9);
    expect(p[1]).toBeCloseTo(-41, 9);
  });
});
