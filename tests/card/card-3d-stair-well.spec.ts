import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn, cam } from "./helpers-3d";
import { readCanvasRect } from "../helpers/pixels";

// 0.26.2: a down flight on the first floor of a real house stayed hidden in 3D. The 0.26.1 well was cut only where the flight lay
// strictly inside a room's outline. In that house the flight touches the edge of its room, so no hole was cut in the room fill and
// the fill lay over it. The fixtures here are invented: two rooms with no wall between them, a fill laid over one of them, and a
// 9-step flight (300 x 135 cm, steps run along x, step k's top is -60 + k * 60 / 9) put (A) on the edge of its room, (B) across two rooms,
// (C) inside a room that has a rug-like fill over it. Real card, real pixels.
interface Hook { project(x: number, y: number, z: number): { x: number; y: number }; look(az: number, polar: number): void }
const hook = <T, A = undefined>(page: Page, fn: (h: Hook, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const STAIR = "#ff00aa";
const rect = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, name: string, kind: string, pts: number[][]) => ({ id, name, kind, pts, area: "room", wk: ["none", "none", "none", "none"] });
function house(stair: number[][], withFill: boolean) {
  const l = structuredClone(demo);
  delete l.floors.test;
  Object.assign(l.floors.first, {
    rooms: [room("hall", "Hall", "room", rect(0, 200, 800, 600)), room("bed", "Bed", "room", rect(0, 0, 800, 200)), ...(withFill ? [room("rug", "Rug", "fill", rect(200, 300, 600, 500))] : [])],
    walls: [], doors: [], openings: [], devices: [], furniture: [], unlinked: [], extras: [],
    stairs: [{ id: "down", name: "Down", pts: stair, shape: "straight", steps: 9, rot: 0, direction: "down", color: STAIR }],
  });
  return l;
}
async function boot(page: Page, layout: unknown, theme: string) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
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
  await hook(page, (h) => h.look(0, 0.1));
}
async function rgbAt(page: Page, p: { x: number; y: number }): Promise<number[]> {
  // The one pixel at the point, from the canvas read in the page (not page.screenshot; tests/helpers/pixels.ts).
  return (await readCanvasRect(page, { x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1 })).data;
}
const pink = ([r, g, b]: number[]) => r > g + 40 && b > g + 20;

const CASES: [string, number[][], number[], boolean][] = [
  ["on the edge of its room (A)", rect(250, 200, 550, 335), [266, 268, -60], false],
  ["across two rooms (B)", rect(250, 120, 550, 255), [266, 188, -60], false],
  ["inside a room, under a fill lying over it (C)", rect(300, 350, 600, 485), [316, 417, -60], true],
];
for (const theme of ["light", "dark"]) for (const [name, stair, at, fill] of CASES) {
  test(`${theme}: a down flight ${name} shows through the slab and every fill`, async ({ page }) => {
    await boot(page, house(stair, fill), theme);
    const p = await hook(page, (h, a: number[]) => h.project(a[0], a[1], a[2]), at); // the deepest step: under 60 cm of slab and fill
    await expect.poll(async () => pink(await rgbAt(page, p)), { timeout: 8000 }).toBe(true);
  });
}
