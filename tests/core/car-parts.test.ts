import { describe, it, expect } from "vitest";
import { CAR_MODELS, type CarModel } from "../../src/core/schema";
import { CAR_SPEC, carParts, carTop, carSpec, type CarPoly } from "../../src/core/car";
import { FURNITURE } from "../../src/core/icons";
import { FURNITURE_HEIGHTS, furnitureHeight } from "../../src/core/heights";

// S35.2, spec C3 and C4, criterion 2. The table is Diego's (2026-10-17): truck is an F-150 with an open bed, utility a Golf.
const FOOTPRINT: Record<CarModel, [number, number, number]> = {
  sedan: [470, 182, 145], wagon: [478, 183, 150], suv: [465, 188, 168], offroad: [480, 196, 195], truck: [590, 203, 196],
  van: [495, 195, 197], utility: [429, 179, 148], citycar: [360, 165, 150], electric: [472, 185, 144],
};
const E = 1e-9;
const centre = (p: CarPoly): [number, number] => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const convex = (p: CarPoly) => { const s = p.map((_, i) => cross(p[i], p[(i + 1) % p.length], p[(i + 2) % p.length])); return s.every((v) => v >= -E) || s.every((v) => v <= E); };
// every vertex of a convex polygon inside another convex polygon (the outline), a hair of slack for "flush"
const inside = (p: CarPoly, outer: CarPoly) => {
  const sign = Math.sign(outer.reduce((s, q, i) => s + cross(outer[0], q, outer[(i + 1) % outer.length]), 0));
  return p.every((v) => outer.every((a, i) => sign * cross(a, outer[(i + 1) % outer.length], v) >= -1e-6));
};

describe("CAR_SPEC: one entry per model", () => {
  it("iterates the union: every model has a spec, nothing else does", () => {
    expect(Object.keys(CAR_SPEC).sort()).toEqual([...CAR_MODELS].sort());
  });
  for (const model of CAR_MODELS) {
    it(`${model}: the footprint and height of spec C3, and the profile order of C4`, () => {
      const s = CAR_SPEC[model];
      expect([s.w, s.h, s.height]).toEqual(FOOTPRINT[model]);
      expect(s.rearGlass, "rear glass from").toBeLessThanOrEqual(s.roofFrom);
      expect(s.roofFrom, "roof from").toBeLessThanOrEqual(s.roofTo);
      expect(s.roofTo, "roof to").toBeLessThanOrEqual(s.windscreen);
      expect(s.windscreen, "windscreen to").toBeLessThan(1 - s.nose);
      expect(s.rearGlass).toBeGreaterThanOrEqual(s.tail);
      expect(s.belt).toBeGreaterThan(0); expect(s.belt).toBeLessThan(1);
      expect(s.cabin).toBeGreaterThan(0.5); expect(s.cabin).toBeLessThan(1);
    });
  }
  it("a sedan is the default and its height is the panel's placeholder", () => {
    expect(FURNITURE.car).toMatchObject({ w: 470, h: 182 });
    expect(FURNITURE_HEIGHTS.car).toBe(CAR_SPEC.sedan.height);
  });
});

describe("carSpec and carParts: an unknown model is a sedan, and nothing throws", () => {
  const JUNK: unknown[] = [undefined, null, 5, "", "Sedan", "__proto__", "constructor", "toString", {}, [], ["suv"], true];
  it("falls back to the sedan for junk", () => {
    for (const j of JUNK) {
      expect(carSpec(j), String(j)).toBe(CAR_SPEC.sedan);
      expect(carParts(j as never), String(j)).toEqual(carParts("sedan"));
      expect(carTop(j as never), String(j)).toBe(carTop("sedan"));
    }
  });
});

describe("carParts: unit-frame polygons, +x the nose", () => {
  for (const model of CAR_MODELS) {
    const p = carParts(model), s = CAR_SPEC[model];
    it(`${model}: the outline is a convex polygon within -0.5..0.5 touching all four sides`, () => {
      expect(convex(p.outline)).toBe(true);
      const xs = p.outline.map((q) => q[0]), ys = p.outline.map((q) => q[1]);
      expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-0.5, 0.5, -0.5, 0.5]);
      expect(p.outline.length).toBe(8); // four corners chamfered
    });
    it(`${model}: glass, roof, wheels, mirrors are convex and inside the outline`, () => {
      for (const [label, poly] of [["rear glass", p.rearGlass], ["roof", p.roof], ["windscreen", p.windscreen], ...p.wheels.map((w, i) => [`wheel ${i}`, w]), ...p.mirrors.map((m, i) => [`mirror ${i}`, m])] as [string, CarPoly][]) {
        expect(convex(poly), label).toBe(true);
        expect(inside(poly, p.outline), label).toBe(true);
      }
    });
    it(`${model}: rear glass, roof and windscreen follow the profile from the tail to the nose`, () => {
      const [rg, rf, ws] = [centre(p.rearGlass)[0], centre(p.roof)[0], centre(p.windscreen)[0]];
      expect(rg).toBeLessThan(rf); expect(rf).toBeLessThan(ws);
      const x = (poly: CarPoly) => [Math.min(...poly.map((q) => q[0])) + 0.5, Math.max(...poly.map((q) => q[0])) + 0.5];
      expect(x(p.rearGlass)).toEqual([s.rearGlass, s.roofFrom].map((v) => expect.closeTo(v, 6)));
      expect(x(p.roof)).toEqual([s.roofFrom, s.roofTo].map((v) => expect.closeTo(v, 6)));
      expect(x(p.windscreen)).toEqual([s.roofTo, s.windscreen].map((v) => expect.closeTo(v, 6)));
    });
    it(`${model}: the glass slopes in, the base at the cabin width and the roof 8 % narrower`, () => {
      const half = (poly: CarPoly) => Math.max(...poly.map((q) => Math.abs(q[1])));
      expect(half(p.rearGlass)).toBeCloseTo(s.cabin / 2, 6);
      expect(half(p.windscreen)).toBeCloseTo(s.cabin / 2, 6);
      expect(half(p.roof)).toBeCloseTo((s.cabin - 0.08) / 2, 6);
    });
    it(`${model}: four wheels flush with the body sides, 64 cm long and 22 cm wide, at the model's axles`, () => {
      expect(p.wheels).toHaveLength(4);
      const axle = model === "offroad" || model === "truck" || model === "van" ? [0.16, 0.82] : [0.18, 0.8];
      const got = p.wheels.map((w) => [centre(w)[0] + 0.5, Math.sign(centre(w)[1])]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      expect(got.map((g) => g[0]).map((v) => +v.toFixed(6))).toEqual([axle[0], axle[0], axle[1], axle[1]]);
      expect(got.map((g) => g[1])).toEqual([-1, 1, -1, 1]);
      for (const w of p.wheels) {
        const xs = w.map((q) => q[0]), ys = w.map((q) => Math.abs(q[1]));
        expect((Math.max(...xs) - Math.min(...xs)) * s.w).toBeCloseTo(64, 2);
        expect((Math.max(...ys) - Math.min(...w.map((q) => Math.abs(q[1])))) * s.h).toBeCloseTo(22, 2);
        expect(Math.max(...ys)).toBeCloseTo(0.5, 6);
      }
    });
    it(`${model}: two mirrors, one each side, mirrored in y`, () => {
      expect(p.mirrors).toHaveLength(2);
      const [a, b] = p.mirrors.map(centre);
      expect(a[0]).toBeCloseTo(b[0], 9); expect(a[1]).toBeCloseTo(-b[1], 9);
    });
  }
  it("the grille is on the nose of every model but the electric", () => {
    for (const model of CAR_MODELS) {
      const g = carParts(model).grille;
      if (model === "electric") { expect(g, model).toBeUndefined(); continue; }
      expect(g, model).toBeDefined();
      expect(centre(g!)[0], model).toBeGreaterThan(0.45);
      expect(inside(g!, carParts(model).outline), model).toBe(true);
    }
  });
  it("only the truck has a bed, behind the cab: .02 to .40 of the length, inside the outline", () => {
    for (const model of CAR_MODELS) {
      const b = carParts(model).bed;
      if (model !== "truck") { expect(b, model).toBeUndefined(); continue; }
      expect(b).toBeDefined();
      const xs = b!.map((q) => q[0] + 0.5);
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([expect.closeTo(0.02, 6), expect.closeTo(0.4, 6)]);
      expect(inside(b!, carParts(model).outline)).toBe(true);
      expect(Math.max(...b!.map((q) => q[0])) + 0.5).toBeLessThanOrEqual(CAR_SPEC.truck.rearGlass + E);
    }
  });
  it("the nose is wider where the tail is: the outline is symmetric about the long axis", () => {
    for (const model of CAR_MODELS) {
      const o = carParts(model).outline;
      for (const [x, y] of o) expect(o.some(([a, b]) => Math.abs(a - x) < 1e-9 && Math.abs(b + y) < 1e-9), `${model} ${x},${y}`).toBe(true);
    }
  });
});

describe("carTop: the 2D markup in the 100 x 100 symbol frame", () => {
  const CLASSES = new Set(["car-body", "car-bed", "car-tyre", "car-glass", "car-roof", "car-mirror", "car-grille"]);
  for (const model of CAR_MODELS) {
    it(`${model}: numbers and fixed class names only, every point in the frame`, () => {
      const svg = carTop(model);
      const tags = svg.match(/<[^>]*>/g) ?? [];
      expect(tags.join("")).toBe(svg); // nothing but tags
      expect(tags.length).toBeGreaterThan(8);
      for (const t of tags) {
        const m = /^<polygon class="([a-z-]+)" points="([-0-9.,\s]+)"\/>$/.exec(t);
        expect(m, t).not.toBeNull();
        expect(CLASSES.has(m![1]), t).toBe(true);
        for (const n of m![2].trim().split(/[\s,]+/)) { expect(Number.isFinite(+n), t).toBe(true); expect(+n).toBeGreaterThanOrEqual(0); expect(+n).toBeLessThanOrEqual(100); }
        expect(t).not.toMatch(/fill=|stroke=|style=/); // colour belongs to the stylesheet (finding 18)
      }
    });
  }
  it("draws a different silhouette for each model", () => {
    expect(new Set(CAR_MODELS.map(carTop)).size).toBe(CAR_MODELS.length);
  });
  it("draws the body first, then glass, roof; the electric has no grille, the truck a bed", () => {
    const cls = (m: CarModel) => (carTop(m).match(/class="([a-z-]+)"/g) ?? []).map((c) => c.slice(7, -1));
    expect(cls("sedan")[0]).toBe("car-body");
    expect(cls("sedan").indexOf("car-glass")).toBeLessThan(cls("sedan").indexOf("car-roof"));
    expect(cls("electric")).not.toContain("car-grille");
    expect(cls("sedan")).toContain("car-grille");
    expect(cls("truck")).toContain("car-bed");
    expect(cls("sedan")).not.toContain("car-bed");
    expect(cls("sedan").filter((c) => c === "car-tyre")).toHaveLength(4);
  });
  it("a nose at +x: the windscreen is drawn right of the rear glass", () => {
    const polys = (m: CarModel) => [...carTop(m).matchAll(/class="car-glass" points="([^"]+)"/g)].map((g) => g[1].split(/\s+/).map((p) => +p.split(",")[0]));
    const [rear, front] = polys("sedan");
    expect(Math.max(...rear)).toBeLessThan(Math.min(...front) + 1);
  });
});

describe("furnitureHeight of a car", () => {
  const car = (extra: object = {}) => ({ id: "c", symbol: "car", x: 0, y: 0, rot: 0, w: 470, h: 182, ...extra }) as never;
  it("is the model's height when the piece has none of its own", () => {
    for (const model of CAR_MODELS) expect(furnitureHeight(car({ model })), model).toBe(CAR_SPEC[model].height);
  });
  it("is the sedan's without a model, or with junk; its own height wins", () => {
    expect(furnitureHeight(car())).toBe(145);
    for (const j of ["Sedan", "__proto__", 5, null]) expect(furnitureHeight(car({ model: j })), String(j)).toBe(145);
    expect(furnitureHeight(car({ model: "van", height: 120 }))).toBe(120);
  });
  it("a model on a piece that is not a car does nothing", () => {
    expect(furnitureHeight({ symbol: "sofa", model: "van" } as never)).toBe(FURNITURE_HEIGHTS.sofa);
  });
});
