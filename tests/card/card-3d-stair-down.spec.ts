import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn, cam } from "./helpers-3d";
import { readCanvasRect } from "../helpers/pixels";

// 0.26.1: the ground plane lay at the lowest slab bottom (-25 cm), and a stair going DOWN sinks to -60 (WELL_DEPTH): most of the
// flight was under the ground and invisible. The first floor of the demo has no stair, so the fixture copies the ground
// floor's (80 x 160 cm, 4 steps) onto it, 250 cm south of the slab: the demo has a third floor above `first`, so the direction is set to down.
interface Hook {
  shade(): { ground: { box: number[] } | null };
  project(x: number, y: number, z: number): { x: number; y: number };
  look(az: number, polar: number): void;
}
const hook = <T, A = undefined>(page: Page, fn: (h: Hook, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const STAIR = "#ff00aa";
const withStair = (inside = false) => {
  const l = structuredClone(demo);
  const st = structuredClone(demo.floors.ground.stairs[0]);
  st.pts = st.pts.map(([x, y]: number[]) => (inside ? [x, y] : [x - 400, y + 250])); // x 300..380, y 670..830: south of the first floor's slab (y 0..600), where nothing covers the flight
  l.floors.first.stairs = [{ ...st, id: "down-1", direction: "down", color: STAIR }];
  return l;
};
async function boot(page: Page, layout: unknown, theme: string) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 900 }); // S31.5: 800 before; the 52 px header band pushed the stair's low steps below the fold, where a screenshot clip cannot reach
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout, floor: "first", view: "3d", theme, active_list: false });
  await drawn(page);
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
async function rgbAt(page: Page, p: { x: number; y: number }): Promise<number[]> {
  // The one pixel at the point, from the canvas read in the page (not page.screenshot; tests/helpers/pixels.ts).
  return (await readCanvasRect(page, { x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1 })).data;
}

// Inside the floor outline and inside the Office room (x 0..800, y 300..600): the slab and the room fill lay over the flight in 0.25.0 as well
// (checked by building that tag): a hole is cut through both. The stair is at x 700..780, y 420..580, steps run along y, step k's top is -60 + 15 k.
for (const theme of ["light", "dark"]) {
  test(`${theme}: a stair going down inside a room shows through a hole in the slab and the room fill`, async ({ page }) => {
    await boot(page, withStair(true), theme);
    await hook(page, (h) => h.look(0, 0.1));
    const p = await hook(page, (h, a: number[]) => h.project(a[0], a[1], a[2]), [740, 560, -60]); // step 0, the deepest, lies under 60 cm of slab and fill
    await expect.poll(async () => { const [r, g, b] = await rgbAt(page, p); return r > g + 40 && b > g + 20; }, { timeout: 8000 }).toBe(true);
    const q = await hook(page, (h, a: number[]) => h.project(a[0], a[1], a[2]), [600, 500, 0]); // the room's floor beside the well is still the room's
    const [r, , b] = await rgbAt(page, q);
    expect(b).toBeGreaterThan(r);
  });
}

for (const theme of ["light", "dark"]) {
  test.describe(`${theme}: a stair going down on the first floor`, () => {
    test("the ground lies below the deepest step", async ({ page }) => {
      await boot(page, withStair(), theme);
      const g = (await hook(page, (h) => h.shade())).ground!;
      expect(g.box[2]).toBeLessThan(-60); // the lowest step's bottom is at -60 - 15
      expect(g.box[2]).toBeGreaterThan(-100); // a small gap, not a hole in the world
    });

    test("the top of a step shows the stair's colour, not the ground's", async ({ page }) => {
      await boot(page, withStair(), theme);
      await hook(page, (h) => h.look(0, 0.1));
      // the stair is 80 x 160 and steps run along y: step k covers y 830 - 40 (k + 1) .. 830 - 40 k, its top at -60 + 15 k. Steps 0 to 2 lie wholly under a ground at -25.
      const p = await hook(page, (h, a: number[]) => h.project(a[0], a[1], a[2]), [340, 810, -60]);
      await expect.poll(async () => { const [r, g, b] = await rgbAt(page, p); return r > g + 40 && b > g + 20; }, { timeout: 8000 }).toBe(true);
    });
  });
}
