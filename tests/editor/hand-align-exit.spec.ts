import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Layout } from "../../src/core/schema";
import { validate } from "../../src/core";
import { serve, ORIGIN, drawn } from "../card/helpers-3d";
import { differing, readPatches } from "../helpers/pixels";
import { FIRST_TO_GROUND } from "../fixtures/hand-align-truth";

// S29.12, the exit test of Sprint 29 (acceptance criterion 12). In the Studio, on the fixture, with real clicks: Align stairs on the ground
// (against the basement), then on the first floor (against the ground), Save. Then the card reads the saved file with `floors_below: solid`:
// each floor's stair footprint corners lie within 2 cm of the stair below's, in the 3D hook's bounds, and the card's ghost sits where the
// truth puts it, read on the screen. Nothing here comes from src/core: the expected corners are worked out by hand from the fixture's stairs
// and the invented truth in hand-align-truth.ts.
const EDITOR = "floorplan-studio-editor";
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/hand-align-house.json", "utf8"));
const rad = (d: number) => (d * Math.PI) / 180;
const turn = (v: number[], d: number): [number, number] => [v[0]! * Math.cos(rad(d)) - v[1]! * Math.sin(rad(d)), v[0]! * Math.sin(rad(d)) + v[1]! * Math.cos(rad(d))];
/** A ground point in the first floor's frame: the inverse of the first-to-ground place, p = R(-t)(p' - s). */
const groundInFirst = (p: number[]): [number, number] => turn([p[0]! - FIRST_TO_GROUND.shift[0], p[1]! - FIRST_TO_GROUND.shift[1]], -FIRST_TO_GROUND.turn);

/** A stair's four corners as drawn: the stored points turned by its `rot` about their centre (the fixture's stairs are drawn a little crooked). */
const footprint = (st: { pts: number[][]; rot: number }): [number, number][] => {
  const c = [0, 1].map((k) => st.pts.reduce((a, q) => a + q[k]!, 0) / st.pts.length);
  return st.pts.map((q) => { const v = turn([q[0]! - c[0]!, q[1]! - c[1]!], st.rot); return [c[0]! + v[0], c[1]! + v[1]]; });
};

/** Studio part: the fixture, two Align stairs, Save. Returns the saved file as the user would get it. */
async function alignAndSave(page: Page): Promise<Layout> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  await page.evaluate(([tag, x]) => { (document.querySelector(tag as string) as any).layout = x; }, [EDITOR, structuredClone(FIXTURE)] as const);
  for (const floor of ["ground", "first"]) {
    await page.locator(`.chip[data-f="${floor}"]`).click();
    await page.locator("#mFloors > summary").click();
    await page.locator("#alignFloor").click();
    await expect(page.locator("#alignPanel")).toBeVisible();
    const b = page.locator("#alignStairsBtn");
    await expect(b).toBeEnabled();
    await b.scrollIntoViewIfNeeded();
    const r = (await b.boundingBox())!;
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    await expect(page.locator("#status")).toHaveText(new RegExp(`^Aligned ${floor === "ground" ? "Ground" : "First"} stairs to ${floor === "ground" ? "Basement" : "Ground"} stairs: moved \\d+ cm, turned`));
    await page.keyboard.press("Escape");
    await expect(page.locator("#alignPanel")).toBeHidden();
  }
  await page.locator("details.menu > summary", { hasText: "File" }).click();
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const saved = JSON.parse(readFileSync(await (await dl).path(), "utf8")) as Layout;
  expect(validate(saved).ok, "the saved file validates").toBe(true);
  return saved;
}

interface Hook { below(): { count: number }; belowSolids(): { kind: string; base: number[][] }[] }
const solids = (page: Page) => page.evaluate(`window.__fp3d.belowSolids()`) as Promise<ReturnType<Hook["belowSolids"]>>;
const belowCount = (page: Page) => page.evaluate(`window.__fp3d.below().count`) as Promise<number>;
async function bootCard(page: Page, layout: unknown, config: Record<string, unknown>) {
  await serve(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((cfg) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout, active_list: false, ...config });
}
/** The stair solids of the floors below that have a base point within `tol` cm of each corner; one list per corner. */
const solidsAt = (all: { kind: string; base: number[][] }[], corners: number[][], tol: number) =>
  corners.map((c) => all.filter((x) => x.kind === "stair" && x.base.some((q) => Math.hypot(q[0]! - c[0]!, q[1]! - c[1]!) <= tol)).length);

test("Align stairs on the ground and the first floor, Save: in the card the stairs of three floors lie on one another within 2 cm", async ({ page }) => {
  const saved = await alignAndSave(page);
  // the Studio wrote a pose on the two upper floors and none on the basement
  expect((saved.floors.basement as any).rotation ?? 0).toBe(0);
  expect(Math.abs((saved.floors.ground as any).rotation)).toBeGreaterThan(1);
  expect(Math.abs((saved.floors.first as any).rotation)).toBeGreaterThan(1);

  const ownFirst = footprint(FIXTURE.floors.first.stairs[0]);
  const ownGround = footprint(FIXTURE.floors.ground.stairs[0]);

  // The ground floor: the basement's stair footprint under it lies on the ground's own stair.
  await bootCard(page, saved, { floor: "ground", view: "3d", floors_below: "solid" });
  await drawn(page);
  await expect.poll(() => belowCount(page), { timeout: 8000 }).toBeGreaterThan(0);
  for (const [i, n] of solidsAt(await solids(page), ownGround, 2).entries()) expect(n, `ground: corner ${i} has a stair block of the basement within 2 cm`).toBeGreaterThanOrEqual(1);

  // The first floor: ground and basement stairs both lie on the first floor's own stair.
  await bootCard(page, saved, { floor: "first", view: "3d", floors_below: "solid" });
  await drawn(page);
  await expect.poll(() => belowCount(page), { timeout: 8000 }).toBeGreaterThan(0);
  const all = await solids(page);
  const perCorner = solidsAt(all, ownFirst, 2);
  // two floors below, each with a block on every footprint corner: at least two stair solids per corner (one pair would be one floor only)
  for (const [i, n] of perCorner.entries()) expect(n, `first: corner ${i} has stair blocks of both floors below within 2 cm`).toBeGreaterThanOrEqual(2);
  // and the same files read with only the ground below (basement taken out) put the ground's stair on the first's within 2 cm
  const noBasement = structuredClone(saved) as any;
  delete noBasement.floors.basement;
  await bootCard(page, noBasement, { floor: "first", view: "3d", floors_below: "solid" });
  await drawn(page);
  await expect.poll(() => belowCount(page), { timeout: 8000 }).toBeGreaterThan(0);
  for (const [i, n] of solidsAt(await solids(page), ownFirst, 2).entries()) expect(n, `ground alone: corner ${i}`).toBeGreaterThanOrEqual(1);
  // control: the unaligned fixture misses by far more than 2 cm, so the check can fail
  await bootCard(page, structuredClone(FIXTURE), { floor: "first", view: "3d", floors_below: "solid" });
  await drawn(page);
  await expect.poll(() => belowCount(page), { timeout: 8000 }).toBeGreaterThan(0);
  expect(solidsAt(await solids(page), ownFirst, 2).some((n) => n === 0), "an unaligned house is more than 2 cm off at some corner").toBe(true);
});

test("the card's ghost of the aligned ground floor is drawn where the truth puts its walls, and 6 px off there is none", async ({ page }) => {
  const saved = await alignAndSave(page);
  await bootCard(page, saved, { floor: "first", view: "2d", ghost_floor: true });
  await expect(page.locator("floorplan-studio-card svg g.ghost")).toHaveCount(1);
  // The ground's wing (y 600..900) lies outside the first floor's outline, so the first floor does not paint over its two long walls, x = 0 and
  // x = 600 on the ground. The card is only as tall as the first floor's plan fits, so the corners at y 900 are cut off; a point of each wall that is
  // outside the first floor's wall and inside the card is picked instead. The wing's walls run along the ground's y axis, which is the first
  // floor's y axis turned by -4 degrees; the 6 px point is on the outer side of the wall.
  const first = FIXTURE.floors.first.outline as number[][];
  const edgeY = (x: number) => { // the first floor's bottom edge (its last, from [959.5, 575.5] to [-38.1, 645.2]) at x
    const [a, b] = [first[2]!, first[3]!]; return a[1]! + ((x - a[0]!) / (b[0]! - a[0]!)) * (b[1]! - a[1]!);
  };
  const walls = [{ x: 0, out: -1 }, { x: 600, out: 1 }].map((w) => {
    const cand = Array.from({ length: 57 }, (_, i) => groundInFirst([w.x, 620 + 5 * i]));
    return { ...w, cand: cand.filter((q) => q[1]! > edgeY(q[0]!) + 30) };
  });
  const spots = await page.locator("floorplan-studio-card").evaluate((el, ws) => {
    const svg = el.shadowRoot!.querySelector("svg") as SVGSVGElement, gh = svg.querySelector("g.ghost") as SVGGElement;
    const m = (gh.parentNode as SVGGraphicsElement).getScreenCTM()!; // the plan's own transform: not read from the ghost
    const box = svg.getBoundingClientRect();
    const scr = (p: number[]) => ({ x: p[0]! * m.a + p[1]! * m.c + m.e, y: p[0]! * m.b + p[1]! * m.d + m.f });
    return ws.map((w) => {
      const pts = w.cand.map(scr).filter((q) => q.y < box.bottom - 12 && q.x > box.left + 12 && q.x < box.right - 12);
      const c = pts[Math.floor(pts.length / 2)]!, d = pts[Math.min(pts.length - 1, Math.floor(pts.length / 2) + 1)] ?? c;
      const e = pts[Math.floor(pts.length / 2) - 1] ?? c, ex = d.x - e.x, ey = d.y - e.y, l = Math.hypot(ex, ey) || 1;
      const nx = (ey / l) * w.out, ny = (-ex / l) * w.out; // the wall's normal, on its outer side
      return { n: pts.length, c, off: { x: c.x + 6 * nx, y: c.y + 6 * ny } };
    });
  }, walls);
  for (const [i, s] of spots.entries()) expect(s.n, `wall ${i}: some of it is outside the first floor and inside the card`).toBeGreaterThan(2);
  // The svg rasterised in the page (tests/helpers/pixels.ts), not page.screenshot: a (2r + 1) px square at the point, at device scale 1.
  const shot = (at: { x: number; y: number }, r: number) => readPatches(page, { host: "floorplan-studio-card", svg: "svg", client: true }, [[at.x, at.y]], 2 * r + 1).then((p) => p[0]!);
  const withGhost = await Promise.all(spots.map((s) => Promise.all([shot(s.c, 7), shot(s.off, 1)])));
  await bootCard(page, saved, { floor: "first", view: "2d", ghost_floor: false });
  await expect(page.locator("floorplan-studio-card svg g.ghost")).toHaveCount(0);
  for (const [i, s] of spots.entries()) {
    const bare = await Promise.all([shot(s.c, 7), shot(s.off, 1)]);
    expect(differing(withGhost[i]![0], bare[0]), `the ghost is drawn on wall ${i}`).toBeGreaterThan(3);
    expect(differing(withGhost[i]![1], bare[1]), `nothing of it 6 px off wall ${i}`).toBe(0);
  }
});
