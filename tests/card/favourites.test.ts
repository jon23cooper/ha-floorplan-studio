import { describe, expect, it } from "vitest";
import { MAX_FAVOURITES, favouritesOf } from "../../src/card/favourites";

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
