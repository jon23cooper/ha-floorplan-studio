// S36.4: how far the bottom sheet lies over the 3D stage. Only the 3D view asks, so it lives in the lazy chunk (it was in
// frame.ts, which the card ships to everyone). Pure numbers, no DOM.
import type { FrameMode, SheetStop, Stops } from "../frame";
import type { Cover } from "./orbit";

export interface Edges { top: number; bottom: number }

const ORDER: SheetStop[] = ["peek", "half", "full"];
const finite = (n: unknown, fallback: number): number => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const positive = (n: unknown): number => Math.max(0, finite(n, 0));

// How far the bottom sheet lies over the 3D stage, in px from each edge. Read from the stop's number, never from the
// sheet's animated box, so a transition in flight does not matter. The stage ends above the peek row, so peek covers 0.
// Only the `bottom` frame covers anything: a side sheet is its own grid column, kiosk has none. Never negative, never
// more than the stage is tall; junk answers 0 (finding 1: input is untrusted).
export function coverOf(stage: Edges, card: Edges, frame: FrameMode, stops: Stops, stop: SheetStop): Cover {
  const none: Cover = { top: 0, right: 0, bottom: 0, left: 0 };
  if (frame !== "bottom" || !ORDER.includes(stop)) return none;
  const stageH = positive(finite(stage?.bottom, 0) - finite(stage?.top, 0));
  const sheetTop = finite(card?.bottom, 0) - finite(stops?.[stop], 0);
  const bottom = Math.min(stageH, positive(finite(stage?.bottom, 0) - sheetTop));
  return { ...none, bottom };
}
