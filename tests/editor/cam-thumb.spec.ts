import { test, expect, type Page } from "@playwright/test";

// S16.3: the Studio's View menu has Camera thumbnail (On/Off, size, position), the same three choices as the card. The pick is a
// viewer preference (View memory, not the layout, never an undo step). Inside Home Assistant the host sets `hassState`; a camera's
// `entity_picture` is a data: picture here so it loads. Real page.mouse on real elements (finding 3).

const EDITOR = "floorplan-studio-editor";
const PIC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const STATES = (state = "idle") => ({ "camera.demo_hall": { state, attributes: { entity_picture: PIC }, last_changed: new Date().toISOString() } });

const click = async (page: Page, sel: string) => {
  const b = (await page.locator(`${EDITOR} ${sel}`).boundingBox())!;
  expect(b, `${sel} has a box`).not.toBeNull();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};
const isOpen = (page: Page, sel: string) => page.evaluate(([tag, s]) => (document.querySelector(tag) as any).shadowRoot.querySelector(s).open, [EDITOR, sel]);
async function pick(page: Page, attr: "camon" | "camsize" | "campos", value: string) {
  if (!(await isOpen(page, "#mOpt"))) await click(page, "#mOpt > summary");
  if (!(await isOpen(page, "#camSub"))) await click(page, "#camSub > summary");
  await click(page, `#camSub button[data-${attr}="${value}"]`);
}
async function open(page: Page, states: Record<string, unknown> | null = STATES()) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  if (states) await page.evaluate(([tag, s]) => { (document.querySelector(tag) as any).hassState = s; }, [EDITOR, states] as const);
}
const images = (page: Page) => page.locator(`${EDITOR} svg image.fp-cam-img`);
const width = async (page: Page) => (await images(page).boundingBox())!.width;

test("View menu: a Camera thumbnail group with On/Off, three sizes and four positions; Off, medium, below at start", async ({ page }) => {
  await open(page);
  await click(page, "#mOpt > summary");
  await click(page, "#camSub > summary");
  const list = (attr: string) => page.locator(`${EDITOR} #camSub button[data-${attr}]`).evaluateAll((els, a) => els.map((e) => e.getAttribute(`data-${a}`)), attr);
  expect(await list("camon")).toEqual(["off", "on"]);
  expect(await list("camsize")).toEqual(["small", "medium", "large"]);
  expect(await list("campos")).toEqual(["above", "below", "left", "right"]);
  for (const [a, v] of [["camon", "off"], ["camsize", "medium"], ["campos", "below"]]) await expect(page.locator(`${EDITOR} #camSub button[data-${a}="${v}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(images(page)).toHaveCount(0);
});

test("On draws the picture beside the camera icon; size and position move it", async ({ page }) => {
  await open(page);
  await pick(page, "camon", "on");
  await expect(images(page)).toHaveCount(1);
  const medium = await width(page);
  await pick(page, "camsize", "large");
  await expect.poll(() => width(page)).toBeGreaterThan(1.4 * medium);
  const below = (await images(page).boundingBox())!;
  await pick(page, "campos", "above");
  await expect.poll(async () => (await images(page).boundingBox())!.y).toBeLessThan(below.y);
  await pick(page, "camon", "off");
  await expect(images(page)).toHaveCount(0);
});

test("standalone, with no camera state: nothing is drawn, an unavailable camera draws nothing", async ({ page }) => {
  await open(page, null);
  await pick(page, "camon", "on");
  await expect(images(page)).toHaveCount(0);
  await page.evaluate(([tag, s]) => { (document.querySelector(tag) as any).hassState = s; }, [EDITOR, STATES("unavailable")] as const);
  await expect(images(page)).toHaveCount(0);
});

test("the pick is not an undo step, survives a reload, and is stored with the view", async ({ page }) => {
  await open(page);
  const undoBefore = await page.locator(`${EDITOR} #undo`).isDisabled();
  await pick(page, "camon", "on");
  await pick(page, "camsize", "small");
  await pick(page, "campos", "left");
  expect(await page.locator(`${EDITOR} #undo`).isDisabled(), "undo stack untouched").toBe(undoBefore);
  // The memory is written after a short delay; wait for it by what it holds, never by time.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("floorplan-studio:view") ?? "{}").cam)).toEqual({ on: true, size: "small", pos: "left" });
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate(([tag, s]) => { (document.querySelector(tag) as any).hassState = s; }, [EDITOR, STATES()] as const);
  await expect(images(page)).toHaveCount(1);
  await click(page, "#mOpt > summary");
  await click(page, "#camSub > summary");
  for (const [a, v] of [["camon", "on"], ["camsize", "small"], ["campos", "left"]]) await expect(page.locator(`${EDITOR} #camSub button[data-${a}="${v}"]`)).toHaveAttribute("aria-pressed", "true");
});

test("a stored pick that is junk is ignored", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("floorplan-studio:view", JSON.stringify({ v: 1, cam: { on: "yes", size: 9, pos: "diagonal" } })));
  await open(page);
  await expect(images(page)).toHaveCount(0);
});
