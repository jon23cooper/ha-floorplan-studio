import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// S23.F2 (finding 10): a window's line must read against its own pane, 3:1 or better, in every theme (ha in dark mode
// too). The pane is `--fp-window` 15 % mixed into the board `--fp-bg`; mixed into the empty room (22 %) it measured
// 2.4 in light and 2.8 in solarized. Computed in Chromium, never hand-picked; a new theme fails until it passes.

const CASES = [...THEMES.map((t) => ({ t, mode: "light" })), { t: "ha", mode: "dark" }] as const;
const body = `<path class="win-pane k-window" d="M0 0H10V4H0Z"/><path class="win-jamb k-window" d="M0 0V4"/><path class="door-sym k-window" d="M0 2H10"/>
<path class="win-pane k-window open" d="M0 0H10V4H0Z"/><path class="win-jamb k-window open" d="M0 0V4"/>`;
const html = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}">${body}</g>`).join("")}</svg></body></html>`;

const rgb = (s: string): number[] => {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (srgb) return srgb.slice(1, 4).map(Number);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  return m.slice(1, 4).map((v) => Number(v) / 255);
};
const lum = (s: string) => { const [r, g, b] = rgb(s).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("S23.F2 a window's line reads against its pane at 3:1 in every theme", async ({ page }) => {
  await page.setContent(html);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!;
    const cs = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    return { pane: cs(".win-pane:not(.open)").fill, jamb: cs(".win-jamb:not(.open)").stroke, sym: cs(".door-sym").stroke };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const tag = `${c.t}/${c.mode}`;
    expect(contrast(r[i].jamb, r[i].pane), `${tag}: jamb vs pane`).toBeGreaterThanOrEqual(3);
    expect(contrast(r[i].sym, r[i].pane), `${tag}: window symbol vs pane`).toBeGreaterThanOrEqual(3);
  });
});
