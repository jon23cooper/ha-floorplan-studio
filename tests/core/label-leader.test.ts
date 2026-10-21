import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Floor, Layout, Pt, RoomKind } from "../../src/core/schema";
import { inside, migrate, renderFloor, viewBoxFor } from "../../src/core";

// S23.F1: at 375 px, with the controls in a column, a leader (the line from a name that fits nowhere in its room, out to
// where the name sits) crossed another room's wall: "Garden pond" and the garden's own leader ran through the Hall and
// the Kitchen. A placed leader is also an obstacle now, so a name placed later keeps off it.

const demo = migrate(JSON.parse(readFileSync("demo/layout.json", "utf8"))) as Layout;
const stress = migrate(JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"))) as Layout;

type Box = [number, number, number, number];
const attr = (tag: string, a: string) => Number(tag.match(new RegExp(` ${a}="([^"]*)"`))?.[1]);
const UNWALLED = new Set<RoomKind>(["garden", "terrace", "pavement", "water", "zone", "fill", "structure"]);
/** What the card passes at a given width (as label-bounds.test.ts): the fit box less a strip its controls cover. */
const card = (f: Floor, view: "2d" | "2.5d", width: number, stripPx: number) => {
  const fit = viewBoxFor(f, 60, undefined, view), px = width / fit.w, scale = 1 / Math.max(1, Math.max(fit.w, fit.h) / 1000);
  return renderFloor(f, { scale, px, view, bounds: { ...fit, w: fit.w - stripPx / px } });
};
const leaders = (html: string) => [...html.matchAll(/<line class="lbl-leader"[^>]*>/g)].map((m) => [[attr(m[0], "x1"), attr(m[0], "y1")], [attr(m[0], "x2"), attr(m[0], "y2")]] as [Pt, Pt]);
const names = (html: string) => [...html.matchAll(/<text class="lbl[^"]*"[^>]*>([^<]*)<\/text>/g)].map((m) => {
  const x = attr(m[0], "x"), y = attr(m[0], "y"), size = attr(m[0], "font-size"), w = m[1].length * 0.6 * size;
  return { name: m[1], box: [x - w / 2, y - 0.75 * size, w, size] as Box };
});
const walk = (a: Pt, b: Pt, fn: (p: Pt) => void) => { for (let t = 0; t <= 1; t += 0.01) fn([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); };
/** The names of the walled rooms the line passes through, other than the one it starts in. */
const crossed = (f: Floor, a: Pt, b: Pt) => {
  const hit = new Set<string>();
  walk(a, b, (p) => f.rooms.forEach((r) => { if (!UNWALLED.has(r.kind) && inside(p, r.pts) && !inside(a, r.pts)) hit.add(r.name ?? "?"); }));
  return [...hit];
};

const VIEWS = ["2d", "2.5d"] as const;
const CASES: [string, Layout][] = [["demo", demo], ["stress", stress]];

describe("S23.F1: leaders and walls at 375 px", () => {
  it("the demo's leaders run through no walled room, with or without a 40 px strip of controls; the one exception is the pond, which has no free side left", () => {
    // 'Garden pond' at 40 px: the strip covers the garden's only free side, so every spot is over the Hall. The garden's
    // own leader (Kitchen, then Hall) was fixed.
    for (const [fk, f] of Object.entries(demo.floors)) for (const view of VIEWS) for (const strip of [0, 40]) {
      const html = card(f, view, 375, strip), pondLeaders: Box[] = [];
      for (const [a, b] of leaders(html)) {
        const hit = crossed(f, a, b), pond = f.rooms.some((r) => r.name === "Garden pond" && inside(a, r.pts));
        if (pond && strip === 40) { pondLeaders.push([a[0], a[1], b[0], b[1]]); continue; }
        expect(hit, `${fk} ${view} strip ${strip}: leader ${a.map(Math.round)} to ${b.map(Math.round)}`).toEqual([]);
      }
      expect(pondLeaders.length).toBeLessThanOrEqual(1);
    }
  });

  it("no leader runs over a name, and no name sits on a leader, on the demo and the stress house", () => {
    for (const [n, l] of CASES) for (const [fk, f] of Object.entries(l.floors)) for (const view of VIEWS) for (const strip of [0, 40]) {
      const html = card(f, view, 375, strip), all = names(html);
      for (const [a, b] of leaders(html)) for (const t of all) {
        const [x, y, w, h] = t.box;
        // The line ends on its own name's box (half a pixel off it); that name is not an obstacle.
        const own = Math.abs(b[0] - (x + w / 2)) < 1 && (Math.abs(b[1] - y) < 2 || Math.abs(b[1] - (y + h)) < 2);
        if (own) continue;
        walk(a, b, (p) => expect(p[0] > x && p[0] < x + w && p[1] > y && p[1] < y + h, `${n} ${fk} ${view} strip ${strip}: leader over "${t.name}"`).toBe(false));
      }
    }
  });
});
