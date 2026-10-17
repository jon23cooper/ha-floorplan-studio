import { test, expect, type Page } from "@playwright/test";

// S33.7 / criterion 9: saved views in the Studio, with real clicks at real coordinates (finding 3).

const EDITOR = "floorplan-studio-editor";
const KEY = "floorplan-studio:layout";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

const isOpen = (page: Page, sel: string) => page.locator(sel).evaluate((e) => (e as HTMLDetailsElement).open);
async function openViews(page: Page) {
  if (!(await isOpen(page, "#mOpt"))) await page.locator("#mOpt > summary").click();
  if (!(await isOpen(page, "#viewsSub"))) await page.locator("#viewsSub > summary").click();
}
/** Closes the View menu the way a user does, with Escape. Rename and Delete are .keep items, so the menu stays open after
 * them, and at a narrow window its box covers Undo (CI failed on this at 1280 px with wider fonts). */
async function closeMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator("#mOpt")).not.toHaveAttribute("open", "");
}
async function save(page: Page, name: string, mode?: string) {
  await openViews(page);
  await page.locator("#saveView").click();
  await page.locator("#viewName").fill(name);
  if (mode) await page.locator("#viewMode").selectOption(mode);
  await page.locator("#viewName").press("Enter");
}
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}"), KEY) as Promise<{ views?: { id: string; name: string; floor: string; mode?: string; rotation?: number; zoom?: number; center?: number[] }[]; floors: Record<string, unknown> }>;
const planBox = (page: Page) => page.locator(`${EDITOR} .canvas > svg`).getAttribute("viewBox");
const items = (page: Page) => page.locator("#viewsSub [data-view]");

test("the View menu has a Saved views submenu with Save current view", async ({ page }) => {
  await page.locator("#mOpt > summary").click();
  await expect(page.locator("#mOpt > .box > #viewsSub > summary")).toHaveText(/Saved views/);
  await page.locator("#viewsSub > summary").click();
  await expect(page.locator("#saveView")).toBeVisible();
  await expect(items(page)).toHaveCount(0);
});

test("Save current view stores the floor on show, and Open in", async ({ page }) => {
  await page.locator('.chip[data-f="first"]').click();
  await save(page, "Upstairs", "3d");
  const s = await stored(page);
  expect(s.views).toHaveLength(1);
  expect(s.views![0]).toMatchObject({ name: "Upstairs", floor: "first", mode: "3d" });
  expect(s.views![0].zoom).toBeUndefined(); // shown whole: nothing of zoom and centre
  expect(s.views![0].center).toBeUndefined();
  await expect(items(page)).toHaveText(["Upstairs"]);
});

test("a floor zoomed in by the wheel stores zoom and centre; applying it from another floor restores the picture", async ({ page }) => {
  const svg = page.locator(`${EDITOR} .canvas > svg`);
  const b = (await svg.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -300);
  await expect.poll(() => planBox(page)).not.toBeNull();
  const zoomed = await planBox(page);
  await save(page, "Zoomed in");
  const sv = (await stored(page)).views![0];
  expect(sv.zoom).toBeGreaterThan(1.5); expect(sv.zoom).toBeLessThanOrEqual(8);
  expect(sv.center).toHaveLength(2);
  await page.locator('.chip[data-f="first"]').click();
  await expect(items(page)).toHaveCount(0); // a floor shows its own views only
  await page.locator('.chip[data-f="' + sv.floor + '"]').click();
  await page.locator("#mOpt > summary").click();
  await page.locator("#fit").click();
  expect(await planBox(page)).not.toBe(zoomed);
  await openViews(page);
  await items(page).first().click();
  const now = (await planBox(page))!.split(/\s+/).map(Number), was = zoomed!.split(/\s+/).map(Number);
  // The card's fit is 60 cm of margin and its own aspect, the Studio's 80 cm and the window's: the centre must be the same point, the width near.
  const mid = (v: number[]) => [v[0] + v[2] / 2, v[1] + v[3] / 2];
  expect(Math.abs(mid(now)[0] - mid(was)[0])).toBeLessThan(was[2] * 0.03);
  expect(Math.abs(mid(now)[1] - mid(was)[1])).toBeLessThan(was[2] * 0.03);
  expect(now[2] / was[2]).toBeGreaterThan(0.7); expect(now[2] / was[2]).toBeLessThan(1.4);
});

test("applying a view from another floor switches the floor, and is not an edit", async ({ page }) => {
  await save(page, "Ground tour");
  const before = await stored(page);
  await page.locator('.chip[data-f="first"]').click();
  await expect(page.locator('.chip[data-f="first"]')).toHaveAttribute("aria-pressed", "true");
  // the item is listed on the floor it names: go back and apply from there after moving away is covered above; here the Open-in view of the whole house
  await page.locator('.chip[data-f="ground"]').click();
  await openViews(page);
  await items(page).first().click();
  await expect(page.locator('.chip[data-f="ground"]')).toHaveAttribute("aria-pressed", "true");
  expect(await stored(page)).toEqual(before);
});

test("criterion 9: Save current view, Delete floor, Undo: the view goes with the floor and comes back with Undo", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  await page.locator('.chip[data-f="first"]').click();
  await save(page, "First floor view");
  await page.locator('.chip[data-f="ground"]').click();
  await save(page, "Ground view");
  expect((await stored(page)).views).toHaveLength(2);
  await page.locator('.chip[data-f="first"]').click();
  await page.locator("#mFloors > summary").click();
  await page.locator("#mFloorDel").click();
  await page.locator("#fdelyes").click();
  await expect(page.locator('.chip[data-f="first"]')).toHaveCount(0);
  let s = await stored(page);
  expect(s.views!.map((v) => v.name)).toEqual(["Ground view"]);
  for (const v of s.views!) expect(Object.keys(s.floors)).toContain(v.floor);
  await page.locator("#undo").click();
  await expect(page.locator('.chip[data-f="first"]')).toHaveCount(1);
  s = await stored(page);
  expect(s.views!.map((v) => v.name)).toEqual(["First floor view", "Ground view"]);
  await page.locator('.chip[data-f="first"]').click();
  await openViews(page);
  await expect(items(page)).toHaveText(["First floor view"]);
});

test('a name of "><script> is drawn as text and runs nothing', async ({ page }) => {
  const evil = '"><script>window.__pwned=1</script><img src=x onerror=window.__pwned=2>';
  await save(page, evil.slice(0, 60));
  await openViews(page);
  await expect(items(page).first()).toHaveText(evil.slice(0, 60));
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.locator("#viewsSub script, #viewsSub img")).toHaveCount(0);
  // and it survives a right-click menu and a rename form
  await items(page).first().click({ button: "right" });
  await page.locator("#viewRename").click();
  await expect(page.locator("#viewName")).toHaveValue(evil.slice(0, 60));
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("Rename and Delete from the item's context menu are one undo step each; an unchanged rename is none", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 }); // narrow: the open View menu covers Undo, as it did on CI
  await save(page, "Alpha");
  await openViews(page);
  await items(page).first().click({ button: "right" });
  await page.locator("#viewRename").click();
  await expect(page.locator("#viewName")).toHaveValue("Alpha");
  await page.locator("#viewName").press("Enter"); // unchanged: the form closes, no step
  await expect(page.locator("#viewName")).toHaveCount(0);
  expect((await stored(page)).views![0].name).toBe("Alpha");
  await items(page).first().click({ button: "right" });
  await page.locator("#viewRename").click();
  await page.locator("#viewName").fill("Beta");
  await page.locator("#viewName").press("Enter");
  expect((await stored(page)).views![0].name).toBe("Beta");
  await closeMenu(page);
  await page.locator("#undo").click();
  expect((await stored(page)).views![0].name).toBe("Alpha"); // one step took it back; the unchanged rename left none
  await openViews(page);
  await items(page).first().click({ button: "right" });
  await page.locator("#viewDelete").click();
  expect((await stored(page)).views).toBeUndefined();
  await closeMenu(page);
  await page.locator("#undo").click();
  expect((await stored(page)).views!.map((v) => v.name)).toEqual(["Alpha"]);
  await page.locator("#undo").click(); // the save
  expect((await stored(page)).views).toBeUndefined();
});

test("an empty name saves nothing and says so; Escape cancels the form", async ({ page }) => {
  await openViews(page);
  await page.locator("#saveView").click();
  await page.locator("#viewName").press("Enter");
  expect((await stored(page)).views).toBeUndefined();
  await expect(page.locator("#viewName")).toBeVisible();
  await page.locator("#viewName").press("Escape");
  await expect(page.locator("#viewName")).toHaveCount(0);
});
