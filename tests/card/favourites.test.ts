import { describe, expect, it } from "vitest";
import { MAX_FAVOURITES, favouriteRefs, favouritesOf } from "../../src/card/favourites";
import type { Layout } from "../../src/core";

// S34.1, spec F1: card YAML is untrusted (finding 1). The reader never throws and says when to warn.

const ids = (config: unknown) => favouritesOf(config).ids;

describe("favouritesOf", () => {
  it("keeps a clean list as it is, in order, with no warning", () => {
    expect(favouritesOf({ favourites: ["light.a", "switch.b_2", "sensor.c"] })).toEqual({ ids: ["light.a", "switch.b_2", "sensor.c"], warn: false });
  });
  it("is empty and silent when the key is absent", () => {
    expect(favouritesOf({})).toEqual({ ids: [], warn: false });
    expect(favouritesOf(undefined)).toEqual({ ids: [], warn: false });
    expect(favouritesOf(null)).toEqual({ ids: [], warn: false });
  });
  it("drops every junk item and warns", () => {
    const r = favouritesOf({ favourites: ["light.a", 5, null, {}, [], "__proto__", "light.Kitchen", "nodot", "light.", ".x", "light.a.b", true, "light.ok"] });
    expect(r.ids).toEqual(["light.a", "light.ok"]);
    expect(r.warn).toBe(true);
  });
  it("trims", () => {
    expect(favouritesOf({ favourites: ["  light.a  "] })).toEqual({ ids: ["light.a"], warn: false });
  });
  it("a value that is not a list is empty and warns", () => {
    for (const v of ["light.a", 5, {}, true, false, 0]) expect(favouritesOf({ favourites: v })).toEqual({ ids: [], warn: true });
  });
  it("null or undefined under the key is the same as absent", () => {
    expect(favouritesOf({ favourites: null })).toEqual({ ids: [], warn: false });
    expect(favouritesOf({ favourites: undefined })).toEqual({ ids: [], warn: false });
  });
  it("drops repeats, first kept, and warns", () => {
    expect(favouritesOf({ favourites: ["light.a", "light.b", "light.a"] })).toEqual({ ids: ["light.a", "light.b"], warn: true });
  });
  it("keeps MAX_FAVOURITES and drops the rest with a warning", () => {
    expect(MAX_FAVOURITES).toBe(24);
    const thirty = Array.from({ length: 30 }, (_, i) => `light.l${i}`);
    const r = favouritesOf({ favourites: thirty });
    expect(r.ids).toEqual(thirty.slice(0, 24));
    expect(r.warn).toBe(true);
    expect(favouritesOf({ favourites: thirty.slice(0, 24) }).warn).toBe(false);
  });
  it("reads the alias favorites", () => {
    expect(ids({ favorites: ["light.a"] })).toEqual(["light.a"]);
  });
  it("favourites wins when both are set", () => {
    expect(ids({ favourites: ["light.a"], favorites: ["light.b"] })).toEqual(["light.a"]);
  });
  it("the alias is used when favourites is null or undefined", () => {
    expect(ids({ favourites: null, favorites: ["light.b"] })).toEqual(["light.b"]);
  });
  it("never throws on a getter that throws, a proxy, or a non-object config", () => {
    const bad = { get favourites(): unknown { throw new Error("no"); } };
    expect(() => favouritesOf(bad)).not.toThrow();
    expect(favouritesOf(bad)).toEqual({ ids: [], warn: true });
    const list = [new Proxy({}, { get() { throw new Error("no"); } }), "light.a"];
    expect(() => favouritesOf({ favourites: list })).not.toThrow();
    for (const c of ["x", 5, true, [], () => 1]) expect(() => favouritesOf(c)).not.toThrow();
  });
  it("copes with an item whose toString throws", () => {
    const evil = { toString() { throw new Error("no"); } };
    expect(() => favouritesOf({ favourites: [evil, "light.a"] })).not.toThrow();
    expect(ids({ favourites: [evil, "light.a"] })).toEqual(["light.a"]);
  });
  it("a 10,000-item list is cut to 24 quickly", () => {
    const big = Array.from({ length: 10_000 }, (_, i) => `light.l${i}`);
    const t = Date.now();
    const r = favouritesOf({ favourites: big });
    expect(r.ids).toHaveLength(24);
    expect(r.warn).toBe(true);
    expect(Date.now() - t).toBeLessThan(500);
  });
  it("a 10,000-item list of junk is empty and warns", () => {
    const r = favouritesOf({ favourites: Array.from({ length: 10_000 }, () => 5) });
    expect(r).toEqual({ ids: [], warn: true });
  });
  it("a sparse list does not throw", () => {
    expect(ids({ favourites: ["light.a", , "light.b"] })).toEqual(["light.a", "light.b"]);
  });
});

// S34.2, spec F4: only things drawn on a floor the card shows.

const dev = (id: string, entity: string, type = "light") => ({ id, type, entity, x: 10, y: 10 });
const floor = (extra: Record<string, unknown>) => ({ title: "F", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...extra });
const layoutOf = (floors: Record<string, unknown>): Layout => ({ version: 2, unit: "cm", north: 0, floors, catalog: [] }) as unknown as Layout;

describe("favouriteRefs", () => {
  const L = layoutOf({
    ground: floor({ devices: [dev("a", "light.a"), dev("b", "switch.b", "switch")] }),
    up: floor({ devices: [dev("c", "light.c")] }),
  });

  it("keeps the list's order, not the layout's", () => {
    const r = favouriteRefs(L, ["light.c", "switch.b", "light.a"], ["ground", "up"]);
    expect(r).toEqual([
      { entity: "light.c", floor: "up", ref: { what: "device", index: 0 } },
      { entity: "switch.b", floor: "ground", ref: { what: "device", index: 1 } },
      { entity: "light.a", floor: "ground", ref: { what: "device", index: 0 } },
    ]);
  });
  it("drops an entity that is not on the plan", () => {
    expect(favouriteRefs(L, ["light.a", "sensor.nope"], ["ground", "up"]).map((r) => r.entity)).toEqual(["light.a"]);
  });
  it("finds a linked furniture piece by its entity", () => {
    const P = layoutOf({
      ground: floor({
        devices: [dev("a", "light.a")],
        furniture: [{ id: "f0", symbol: "sofa", x: 0, y: 0, w: 10, h: 10, rot: 0 }, { id: "tv", symbol: "tv", entity: "media_player.tv", x: 5, y: 5, w: 10, h: 10, rot: 0 }],
      }),
    });
    expect(favouriteRefs(P, ["media_player.tv"], ["ground"])).toEqual([{ entity: "media_player.tv", floor: "ground", ref: { what: "piece", index: 1 } }]);
  });
  it("ignores an entity on a floor the card leaves out", () => {
    expect(favouriteRefs(L, ["light.a", "light.c"], ["ground"]).map((r) => r.entity)).toEqual(["light.a"]);
    expect(favouriteRefs(L, ["light.a", "light.c"], [])).toEqual([]);
  });
  it("two devices on one entity: the first in layout order wins, across floors too", () => {
    const D = layoutOf({
      ground: floor({ devices: [dev("a", "light.x"), dev("b", "light.x")] }),
      up: floor({ devices: [dev("c", "light.x")] }),
    });
    expect(favouriteRefs(D, ["light.x"], ["ground", "up"])).toEqual([{ entity: "light.x", floor: "ground", ref: { what: "device", index: 0 } }]);
    expect(favouriteRefs(D, ["light.x"], ["up"])).toEqual([{ entity: "light.x", floor: "up", ref: { what: "device", index: 0 } }]);
  });
  it("a device beats a piece on the same entity when it comes first in the floor", () => {
    const D = layoutOf({ g: floor({ devices: [dev("a", "media_player.tv", "media")], furniture: [{ id: "tv", symbol: "tv", entity: "media_player.tv", x: 5, y: 5, w: 1, h: 1, rot: 0 }] }) });
    expect(favouriteRefs(D, ["media_player.tv"], ["g"])[0]!.ref).toEqual({ what: "device", index: 0 });
  });
  it("a repeat in the ids gives one ref", () => {
    expect(favouriteRefs(L, ["light.a", "light.a"], ["ground"])).toHaveLength(1);
  });
  it("a floor named __proto__ is an ordinary floor", () => {
    const P = JSON.parse('{"version":2,"unit":"cm","north":0,"catalog":[],"floors":{"__proto__":{"devices":[{"id":"p","type":"light","entity":"light.p","x":1,"y":1}],"furniture":[]},"toString":{"devices":[{"id":"q","type":"light","entity":"light.q","x":1,"y":1}]}}}') as Layout;
    expect(favouriteRefs(P, ["light.p", "light.q"], ["__proto__", "toString"])).toEqual([
      { entity: "light.p", floor: "__proto__", ref: { what: "device", index: 0 } },
      { entity: "light.q", floor: "toString", ref: { what: "device", index: 0 } },
    ]);
    expect(favouriteRefs(P, ["light.p"], ["constructor"])).toEqual([]);
    expect(({} as Record<string, unknown>)["light"]).toBeUndefined(); // no pollution
  });
  it("junk layout rows are skipped and never thrown on", () => {
    const J = layoutOf({
      a: null,
      b: 5,
      c: floor({ devices: [null, 7, "x", { type: "light" }, { entity: 5 }, { entity: "" }, dev("ok", "light.ok")], furniture: [null, 3, { symbol: "tv", entity: 9 }] }),
      d: floor({ devices: 5, furniture: "no" }),
      e: floor({ devices: [dev("z", "light.z")] }),
    });
    expect(() => favouriteRefs(J, ["light.ok", "light.z"], ["a", "b", "c", "d", "e"])).not.toThrow();
    expect(favouriteRefs(J, ["light.ok", "light.z"], ["a", "b", "c", "d", "e"])).toEqual([
      { entity: "light.ok", floor: "c", ref: { what: "device", index: 6 } },
      { entity: "light.z", floor: "e", ref: { what: "device", index: 0 } },
    ]);
  });
  it("a layout that is not a layout gives nothing", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { floors: 5 }, { floors: null }]) {
      expect(favouriteRefs(bad as unknown as Layout, ["light.a"], ["ground"])).toEqual([]);
    }
  });
  it("junk in ids and floors is tolerated", () => {
    expect(favouriteRefs(L, [5, null, "light.a"] as unknown as string[], ["ground", 3] as unknown as string[]).map((r) => r.entity)).toEqual(["light.a"]);
    expect(favouriteRefs(L, "light.a" as unknown as string[], "ground" as unknown as string[])).toEqual([]);
  });
});
