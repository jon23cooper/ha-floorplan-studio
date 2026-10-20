// S16.3: the camera thumbnail. A small live picture beside each camera icon, from the camera's own `entity_picture`
// (Home Assistant's authenticated proxy path, which already carries its token). Pure: which sizes and sides there are,
// what a picture url may be, where the box sits. No import, so the 3D chunk may be handed it (core/three-deps.ts).
// States and options are untrusted (finding 1): nothing here throws.

export const CAM_SIZES = ["small", "medium", "large"] as const;
export const CAM_POS = ["above", "below", "left", "right"] as const;
export type CamSize = (typeof CAM_SIZES)[number];
export type CamPos = (typeof CAM_POS)[number];
export interface CamThumb { on: boolean; size: CamSize; pos: CamPos }
/** What the draw call is given: the choice, the cache buster, and the cameras whose picture failed to load (drawn as nothing until the next refresh). */
export type CamThumbOpts = CamThumb & { bust: number; failed?: ReadonlySet<string> };
export const CAM_REFRESH_MS = 10_000;

/** Width at scale 1 (plan units in 2D, pixels in 3D); the height is 16:9. */
const WIDTH: Record<CamSize, number> = { small: 64, medium: 96, large: 144 };
/** From the icon's centre to the box's near edge: past the 16-unit halo. */
const GAP = 20;
const word = <T extends string>(list: readonly T[], v: unknown, dflt: T): T => list.find((x) => x === v) ?? dflt;

/**
 * The choice from the card's YAML (`camera_thumb`, `camera_thumb_size`, `camera_thumb_pos`), each field overridden by the viewer's pick.
 * YAML 1.1 reads an unquoted `on` / `off` as a boolean, so both spellings count. Junk is the default: off, medium, below.
 */
export function camThumbOf(cfg: Record<string, unknown>, pick?: Partial<CamThumb> | null): CamThumb {
  const on = pick?.on ?? (cfg.camera_thumb === true || cfg.camera_thumb === "on");
  return { on, size: pick?.size ?? word(CAM_SIZES, cfg.camera_thumb_size, "medium"), pos: pick?.pos ?? word(CAM_POS, cfg.camera_thumb_pos, "below") };
}

/** A stored or typed pick, kept only for the fields that are well formed; null when none is. */
export function camPickOf(raw: unknown): Partial<CamThumb> | null {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>, out: Partial<CamThumb> = {};
  if (typeof r.on === "boolean") out.on = r.on;
  const size = CAM_SIZES.find((s) => s === r.size), pos = CAM_POS.find((p) => p === r.pos);
  if (size) out.size = size;
  if (pos) out.pos = pos;
  return Object.keys(out).length ? out : null;
}

/**
 * The picture url of a camera state, or null (draw nothing). Only a path on this Home Assistant (`/...`, not `//`, no backslash or
 * control character) or an inline image is taken: a remote url would be a request to a third party. `fp_t` makes the browser ask
 * again; an inline image is the same bytes every time and keeps its url.
 */
export function thumbUrl(s: unknown, bust: number): string | null {
  const o = (typeof s === "object" && s !== null ? s : {}) as { state?: unknown; attributes?: { entity_picture?: unknown } | null };
  const p = o.attributes?.entity_picture;
  if (typeof p !== "string" || o.state === "unavailable" || o.state === "unknown" || o.state === undefined) return null;
  if (/[\u0000-\u001f\\]/.test(p)) return null;
  if (/^data:image\/(png|jpeg|gif|webp);base64,[\w+/=]+$/.test(p)) return p;
  return /^\/(?!\/)/.test(p) ? `${p}${p.includes("?") ? "&" : "?"}fp_t=${bust}` : null;
}

/**
 * The thumbnail's box (top left, width, height) for an icon centred on `at`, in the frame `at` is in. `k` scales it as it scales the
 * icon. With `within` it is pulled back inside that box; one that cannot fit is left where it falls.
 */
export function thumbBox(at: readonly [number, number], t: Pick<CamThumb, "size" | "pos">, k: number, within?: { x: number; y: number; w: number; h: number } | null): { x: number; y: number; w: number; h: number } {
  const w = WIDTH[word(CAM_SIZES, t.size, "medium")] * k, h = (w * 9) / 16, g = GAP * k, pos = word(CAM_POS, t.pos, "below");
  let x = pos === "left" ? at[0] - g - w : pos === "right" ? at[0] + g : at[0] - w / 2;
  let y = pos === "above" ? at[1] - g - h : pos === "below" ? at[1] + g : at[1] - h / 2;
  if (within && within.w >= w && within.h >= h) {
    x = Math.min(Math.max(x, within.x), within.x + within.w - w);
    y = Math.min(Math.max(y, within.y), within.y + within.h - h);
  }
  return { x, y, w, h };
}

/**
 * The refresh clock of one view (the card, the Studio). It owns the cache buster and the cameras whose picture failed, runs only
 * while `want(true)` and the tab is shown, and starts over on a return to the tab. `change` is the view's redraw.
 */
export class ThumbFeed {
  bust = Date.now();
  failed = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private wanted = false;
  constructor(private change: () => void, private period = CAM_REFRESH_MS) {}
  private tick = () => { this.bust = Date.now(); this.failed.clear(); this.change(); };
  private onVisible = () => { if (document.hidden) this.halt(); else if (this.wanted) { this.run(); this.tick(); } };
  private halt() { if (this.timer !== null) clearInterval(this.timer); this.timer = null; }
  private run() { this.halt(); this.timer = setInterval(this.tick, this.period); }
  /** True while the pictures are drawn and the view is on a page. Safe to call on every render. */
  want(on: boolean) {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) { document.addEventListener("visibilitychange", this.onVisible); if (!document.hidden) this.run(); }
    else { document.removeEventListener("visibilitychange", this.onVisible); this.halt(); }
  }
  /** A picture that could not load is drawn as nothing until the next refresh. */
  fail(entity: string) { if (entity && !this.failed.has(entity)) { this.failed.add(entity); this.change(); } }
}
