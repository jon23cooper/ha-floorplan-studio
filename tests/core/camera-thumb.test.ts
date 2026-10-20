import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderFloor, type RenderOpts } from "../../src/core/render";
import { validate, type Layout } from "../../src/core/index";
import { CAM_POS, CAM_SIZES, ThumbFeed, camThumbOf, thumbBox, thumbUrl } from "../../src/core/camera-thumb";

// S16.3: the camera thumbnail. The pure helpers, then renderFloor's markup (one draw path, finding 8).
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const ground = demo.floors.ground!;
const camIdx = ground.devices.findIndex((d) => d.type === "camera");
const cam = ground.devices[camIdx]!;
const PIC = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
// HA's camera state: `entity_picture` is the relative proxy path with an access token (the shape HA's camera entity gives).
const st = (state: string, entity_picture?: unknown) => ({ state, attributes: entity_picture === undefined ? {} : { entity_picture }, last_changed: "2026-10-21T10:00:00Z" });
const on = { on: true, size: "medium", pos: "below", bust: 7 } as const;
const withCam = (state: unknown, ct: RenderOpts["camThumb"] = on, extra: Partial<RenderOpts> = {}) =>
  renderFloor(ground, { scale: 1, state: state as never, camThumb: ct, ...extra });
const images = (html: string) => [...html.matchAll(/<image [^>]*>/g)].map((m) => m[0]);

describe("camThumbOf (YAML and picks)", () => {
  it("defaults to off, medium, below", () => expect(camThumbOf({})).toEqual({ on: false, size: "medium", pos: "below" }));
  it("reads on/off words and the booleans YAML turns them into", () => {
    expect(camThumbOf({ camera_thumb: "on" }).on).toBe(true);
    expect(camThumbOf({ camera_thumb: true }).on).toBe(true);
    expect(camThumbOf({ camera_thumb: "off" }).on).toBe(false);
    expect(camThumbOf({ camera_thumb: false }).on).toBe(false);
    expect(camThumbOf({ camera_thumb: "yes" }).on).toBe(false);
    expect(camThumbOf({ camera_thumb: 1 }).on).toBe(false);
  });
  it("takes every size and position, and falls back on junk", () => {
    for (const size of CAM_SIZES) expect(camThumbOf({ camera_thumb_size: size }).size).toBe(size);
    for (const pos of CAM_POS) expect(camThumbOf({ camera_thumb_pos: pos }).pos).toBe(pos);
    expect(camThumbOf({ camera_thumb_size: "huge", camera_thumb_pos: "Above" })).toEqual({ on: false, size: "medium", pos: "below" });
    expect(camThumbOf({ camera_thumb_size: {}, camera_thumb_pos: null })).toEqual({ on: false, size: "medium", pos: "below" });
  });
  it("a viewer's pick wins over the YAML, field by field", () => {
    expect(camThumbOf({ camera_thumb: "on", camera_thumb_pos: "left" }, { on: false, size: "large" })).toEqual({ on: false, size: "large", pos: "left" });
  });
});

describe("thumbUrl", () => {
  it("reads a relative proxy path and adds the cache buster", () => {
    expect(thumbUrl(st("idle", "/api/camera_proxy/camera.x?token=abc"), 5)).toBe("/api/camera_proxy/camera.x?token=abc&fp_t=5");
    expect(thumbUrl(st("idle", "/local/x.jpg"), 5)).toBe("/local/x.jpg?fp_t=5");
  });
  it("leaves a data: image as it is", () => expect(thumbUrl(st("idle", PIC), 5)).toBe(PIC));
  it("draws nothing for an unavailable or unknown camera, a missing state, or no picture", () => {
    for (const s of [st("unavailable", "/a"), st("unknown", "/a"), st("idle"), undefined, null, 3, "x", { state: "idle" }]) expect(thumbUrl(s, 1), JSON.stringify(s)).toBeNull();
  });
  it("refuses a picture that would leave Home Assistant, or is not a path", () => {
    for (const p of ["https://evil.example/a.jpg", "//evil.example/a.jpg", "/\\evil.example", "http://x", "javascript:alert(1)", "data:text/html,<b>", "relative/a.jpg", "", 3, null, {}, "/a\nb"]) expect(thumbUrl(st("idle", p), 1), String(p)).toBeNull();
  });
});

describe("thumbBox", () => {
  const at: [number, number] = [100, 100];
  it("sits on the chosen side of the icon, centred on the other axis", () => {
    const below = thumbBox(at, { size: "medium", pos: "below" }, 1), above = thumbBox(at, { size: "medium", pos: "above" }, 1);
    const left = thumbBox(at, { size: "medium", pos: "left" }, 1), right = thumbBox(at, { size: "medium", pos: "right" }, 1);
    expect(below.x + below.w / 2).toBe(100); expect(below.y).toBeGreaterThan(100);
    expect(above.x + above.w / 2).toBe(100); expect(above.y + above.h).toBeLessThan(100);
    expect(left.y + left.h / 2).toBe(100); expect(left.x + left.w).toBeLessThan(100);
    expect(right.y + right.h / 2).toBe(100); expect(right.x).toBeGreaterThan(100);
  });
  it("small < medium < large, 16:9, and scales with k", () => {
    const w = CAM_SIZES.map((size) => thumbBox(at, { size, pos: "below" }, 1).w);
    expect(w[0]).toBeLessThan(w[1]!); expect(w[1]).toBeLessThan(w[2]!);
    const b = thumbBox(at, { size: "large", pos: "below" }, 2);
    expect(b.w).toBe(w[2]! * 2); expect(b.h).toBeCloseTo((b.w * 9) / 16, 6);
  });
  it("is pulled inside the box it is given, and left alone when it cannot fit", () => {
    const within = { x: 0, y: 0, w: 300, h: 200 };
    for (const pos of CAM_POS) for (const p of [[0, 0], [300, 200], [150, 0], [0, 100], [300, 100], [150, 200]] as [number, number][]) {
      const b = thumbBox(p, { size: "large", pos }, 1, within);
      expect(b.x, `${pos} ${p}`).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(300); expect(b.y + b.h).toBeLessThanOrEqual(200);
    }
    const free = thumbBox(at, { size: "large", pos: "below" }, 1);
    expect(thumbBox(at, { size: "large", pos: "below" }, 1, { x: 0, y: 0, w: 10, h: 10 })).toEqual(free);
  });
  it("junk size and position fall back instead of giving NaN", () => {
    const b = thumbBox(at, { size: "x" as never, pos: "y" as never }, 1);
    expect(Object.values(b).every(Number.isFinite)).toBe(true);
  });
});

describe("renderFloor draws the thumbnail", () => {
  it("draws one image per camera that has a picture, tagged with its device index, as the url asks", () => {
    const html = withCam({ [cam.entity]: st("idle", "/api/camera_proxy/camera.demo_hall?token=t") });
    const imgs = images(html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain(`href="/api/camera_proxy/camera.demo_hall?token=t&amp;fp_t=7"`);
    expect(html).toContain(`<g class="fp-cam-thumb" data-cam="${camIdx}"`);
  });
  it("is byte for byte the old markup with the option off, absent, junk, or without a camera picture", () => {
    const states = { [cam.entity]: st("idle", PIC) };
    const plain = renderFloor(ground, { scale: 1, state: states as never });
    for (const ct of [undefined, { ...on, on: false }, null, 5, "on"]) expect(renderFloor(ground, { scale: 1, state: states as never, camThumb: ct as never })).toBe(plain);
    expect(renderFloor(ground, { scale: 1, state: {}, camThumb: on })).toBe(renderFloor(ground, { scale: 1, state: {} }));
    expect(plain).not.toContain("<image");
  });
  it("a floor with no camera is the same bytes, thumbnails on or off", () => {
    const f = { ...ground, devices: ground.devices.filter((d) => d.type !== "camera") };
    expect(renderFloor(f, { scale: 1, camThumb: on, state: {} })).toBe(renderFloor(f, { scale: 1, state: {} }));
  });
  it("draws nothing for an unavailable camera, or one that failed to load", () => {
    expect(images(withCam({ [cam.entity]: st("unavailable", PIC) }))).toHaveLength(0);
    expect(images(withCam({ [cam.entity]: st("idle", PIC) }, { ...on, failed: new Set([cam.entity]) }))).toHaveLength(0);
  });
  it("escapes the url: a payload cannot close the attribute", () => {
    const evil = `/api/x?a="><script>alert(1)</script>&b='`;
    const html = withCam({ [cam.entity]: st("idle", evil) });
    expect(html).not.toContain("<script");
    expect(html).not.toContain(`"><script`);
    expect(images(html)).toHaveLength(1);
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
  it("refuses a picture outside Home Assistant (a remote url draws nothing)", () => {
    expect(images(withCam({ [cam.entity]: st("idle", "https://evil.example/a.jpg") }))).toHaveLength(0);
    expect(images(withCam({ [cam.entity]: st("idle", `"><script>`) }))).toHaveLength(0);
  });
  it("stays inside the view box in every position, in 2D and 2.5D", () => {
    for (const pos of CAM_POS) for (const size of CAM_SIZES) for (const view of ["2d", "2.5d"] as const) {
      const html = withCam({ [cam.entity]: st("idle", PIC) }, { ...on, pos, size }, { view, bounds: { x: 0, y: 0, w: 1000, h: 800 } });
      const m = /<image [^>]*x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(html)!;
      const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
      expect(x, `${view} ${pos} ${size}`).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(1000); expect(y + h).toBeLessThanOrEqual(800);
    }
  });
  it("in the editor the thumbnail is not a tap target", () => {
    const html = withCam({ [cam.entity]: st("idle", PIC) }, on, { editor: true });
    expect(html).toContain("fp-cam-ed");
    expect(html).not.toContain("data-cam=");
  });
});

describe("validate never throws on a camera with junk", () => {
  it("a camera with odd fields still validates or fails with a message", () => {
    for (const junk of [null, 5, "x", {}, [], { type: "camera", entity: 5 }, { type: "camera", entity: "camera.x", x: "a", y: null }]) {
      const l = structuredClone(demo) as unknown as { floors: { ground: { devices: unknown[] } } };
      l.floors.ground.devices.push(junk);
      expect(() => validate(l)).not.toThrow();
    }
  });
});

describe("ThumbFeed", () => {
  const hide = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    hide(false);
  });
  it("ticks every 10 s while wanted, with a new buster and the failed set cleared", () => {
    vi.useFakeTimers({ now: 1_000 });
    const change = vi.fn(), feed = new ThumbFeed(change);
    feed.want(true);
    feed.failed.add("camera.x");
    vi.advanceTimersByTime(9_999);
    expect(change).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(feed.bust).toBe(11_000);
    expect(feed.failed.size).toBe(0);
    feed.want(false);
  });
  it("pauses while the tab is hidden and when not wanted, and resumes with an at-once refresh", () => {
    vi.useFakeTimers({ now: 0 });
    const change = vi.fn(), feed = new ThumbFeed(change);
    feed.want(true);
    hide(true);
    vi.advanceTimersByTime(60_000);
    expect(change).not.toHaveBeenCalled();
    hide(false);
    expect(change).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(change).toHaveBeenCalledTimes(2);
    feed.want(false);
    vi.advanceTimersByTime(60_000);
    expect(change).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a hidden tab that was never wanted stays quiet", () => {
    vi.useFakeTimers();
    const change = vi.fn();
    new ThumbFeed(change);
    hide(true);
    hide(false);
    vi.advanceTimersByTime(60_000);
    expect(change).not.toHaveBeenCalled();
  });
  it("fail() redraws once per camera", () => {
    const change = vi.fn(), feed = new ThumbFeed(change);
    feed.fail("camera.x");
    feed.fail("camera.x");
    expect(change).toHaveBeenCalledTimes(1);
  });
});
