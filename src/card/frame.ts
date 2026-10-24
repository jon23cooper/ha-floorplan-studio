// The card's frame: how wide the sheet is, how tall the card is, where a bottom sheet stops. Pure numbers, no DOM,
// so the card and its tests read the same answers. Defaults D1 to D4 of docs/specs/card-layout-touch.md.
//
// Why 640. At 640 px a side sheet (260 px at least) leaves the plan 380 px, a square the finger can still read. Under
// it the plan would shrink under 300 px, so the sheet goes below the plan instead. 900 px is where the plan keeps 580
// px beside an open 288 px sheet; a wall tablet at 768 starts folded and the plan keeps its width.
//
// The phone minimum (D2 and the "fit to height" assumption pull against each other). D2: a card with a bottom sheet is
// at least min(100dvh - HA header, 640) tall, so Half (max(50 %, 340)) shows a room's Lights off without scrolling.
// Fit to height: never taller than 100dvh - HA header - 16, so the bottom edge is never under the browser chrome.
// A short plan (3:1 at 390 wide is 130 px) would make a 246 px card, and Half needs 340 alone. So the minimum raises
// the card, the plan letterboxes in what the header and the peek leave. When the two clash (a screen under 656 px
// above the HA header) the cap wins by taking the 16 px off the minimum too: a card that fits is worth more than one
// 16 px longer that hides its bottom edge. So the result never goes over the cap, except the hard floor MIN_CARD, which
// only a broken measurement (viewport 0, header taller than the screen) can reach. The minimum is for `bottom` mode
// only: a side sheet scrolls inside its own column and needs no height, and `none` (kiosk) has no sheet.
//
// The snap rule. Velocity is the sheet's height change in px per ms; up is positive. A drag lands on the stop nearest
// the finger; a tie goes to the smaller sheet (the plan stays visible). A fling, more than 0.5 px/ms (about 30 px in
// a 60 ms swipe, past the 10 px a finger wobbles), goes to the next stop beyond where the finger let go, in its
// direction: never two. "One stop its way" is measured from the finger, not from the nearest stop: a drag from Peek
// to just under Half, flung up, ends at Half, not Full. A fling that has no stop that way stays at the end. Exactly
// 0.5 is not a fling, so slow drags and held releases never jump. Stops closer than 0.5 px count as the same stop.
//
// Junk (NaN, negative, infinite) is not an error. Every function answers a finite number or a valid name, so a
// half-measured card renders something and the next measure corrects it.

export type FrameMode = "side" | "bottom" | "none";
export type SheetStop = "peek" | "half" | "full";
export type Stops = Record<SheetStop, number>;

export const SIDE_MIN_WIDTH = 640;
export const SIDE_OPEN_WIDTH = 900;
export const HEADER_H = 52;
export const PEEK_H = 64;
export const FLING_PX_PER_MS = 0.5;
const SIDE_MIN = 260;
const SIDE_MAX = 320;
const HALF_MIN = 340;
const PHONE_MIN_CARD = 640;
const GUTTER = 16;
const MIN_CARD = 120;
const EPS = 0.5;
const ORDER: SheetStop[] = ["peek", "half", "full"];

const finite = (n: unknown, fallback: number): number =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;
const positive = (n: unknown): number => Math.max(0, finite(n, 0));

export function frameMode(width: number, opts: { kiosk?: boolean; sheet?: boolean } = {}): FrameMode {
  if (opts?.kiosk || opts?.sheet === false) return "none";
  return typeof width === "number" && width >= SIDE_MIN_WIDTH ? "side" : "bottom";
}

export function sideWidth(width: number): number {
  const w = Math.min(SIDE_MAX, Math.max(SIDE_MIN, 0.32 * positive(width)));
  return w;
}

export function sideOpenByDefault(width: number): boolean {
  return typeof width === "number" && width >= SIDE_OPEN_WIDTH;
}

export interface CardHeightIn {
  planAspect: number; // plan width / plan height
  width: number; // card width
  viewportH: number; // visual viewport height; 0 or junk means unknown, no cap
  haHeader: number;
  chrome: number; // px the frame adds above and below the plan: header, and the peek in `bottom`
  mode: FrameMode;
}

export function cardHeight(i: CardHeightIn): number {
  const aspect = Math.min(5, Math.max(0.2, finite(i?.planAspect, 4 / 3)));
  const natural = positive(i?.width) / aspect + positive(i?.chrome);
  const vh = finite(i?.viewportH, 0);
  const cap = vh > 0 ? vh - positive(i?.haHeader) - GUTTER : Infinity;
  let h = Math.min(natural, cap);
  if (i?.mode === "bottom") h = Math.max(h, Math.min(cap, PHONE_MIN_CARD));
  return Math.max(h, MIN_CARD);
}

export function sheetStops(cardH: number, headerH: number): Stops {
  const card = positive(cardH);
  const peek = Math.min(PEEK_H, card);
  const full = Math.max(card - positive(headerH), peek);
  const half = Math.min(Math.max(card * 0.5, HALF_MIN), full);
  return { peek, half, full };
}

export function snapSheet(h: number, velocity: number, stops: Stops): SheetStop {
  const at = (s: SheetStop): number => finite(stops?.[s], 0);
  const y = finite(h, 0);
  const v = Number.isNaN(velocity) ? 0 : velocity;
  if (Math.abs(v) > FLING_PX_PER_MS) {
    if (v > 0) {
      for (const s of ORDER) if (at(s) > y + EPS) return s;
      return "full";
    }
    for (const s of [...ORDER].reverse()) if (at(s) < y - EPS) return s;
    return "peek";
  }
  let best: SheetStop = "peek";
  for (const s of ORDER) if (Math.abs(at(s) - y) < Math.abs(at(best) - y)) best = s;
  return best;
}

export function nextOnHandleTap(stop: SheetStop): SheetStop {
  return stop === "peek" ? "half" : stop === "half" ? "peek" : stop === "full" ? "half" : "half";
}
