import { test, expect, type Page } from "@playwright/test";
import { demo, open, card, canvas, holder, drawn } from "./helpers-3d";
import { readCanvasRect } from "../helpers/pixels";

// S12 review S4: at phone width the Active list folds to a 36 px header. The camera must not give half the card's width
// to that header; it frames the house in the whole width. An open list (a wide card, or one the user opened) still gets its inset.

/** The model's left and right edge in the canvas, as shares of its width (the list is hidden so it is not read as model). */
const spread = async (page: Page) => {
  await card(page).locator("css=.fp-active").evaluate((el: HTMLElement) => { el.style.visibility = "hidden"; });
  const box = (await canvas(page).boundingBox())!;
  // The canvas read in the page (tests/helpers/pixels.ts), not page.screenshot.
  const { w, h, data: d } = await readCanvasRect(page, box);
  let min = w, max = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 24) { min = Math.min(min, x); max = Math.max(max, x); }
  }
  return { min: min / w, max: max / w, width: max / w - min / w };
};
// S32.5: `data-frame` is the px the card covers, "top,right,bottom,left" (it was `data-inset`, two horizontal shares).
const frame = async (page: Page) => ((await holder(page).getAttribute("data-frame")) ?? "").split(",").map(Number);

for (const [w, h] of [[375, 700], [260, 800]] as const) {
  test(`${w}x${h}: a folded Active list takes no width from the house`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d", active_list: true });
    await page.evaluate((w) => { (document.getElementById("wrap") as HTMLElement).style.width = `${w}px`; }, w);
    await drawn(page);
    await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "peek"); // S31.8: folded is the sheet at its peek
    await expect.poll(async () => (await frame(page)).join()).toBe("0,0,0,0"); // peek covers nothing
    const s = await spread(page);
    expect(s.width, JSON.stringify(s)).toBeGreaterThan(0.7); // the house fills the width; half of it was lost before
  });
}

// S31.8: under 640 px the list is a bottom sheet across the whole width, not a box beside the house, so it asks the camera for no
// left or right inset (S32.5: the camera now takes the sheet's cover from below, `coverOf`, and still none from a side).
// The house is framed in the full width at every stop. The old test asserted an inset above 0.05 for the floating box, which is gone.
test("375x700: an opened sheet covers the stage from below, takes no side from the house", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d", active_list: true });
  await page.evaluate(() => { (document.getElementById("wrap") as HTMLElement).style.width = "375px"; });
  await drawn(page);
  await card(page).getByRole("button", { name: "Overview" }).click();
  await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "half");
  await expect(card(page).locator("css=.fp-active-body")).not.toHaveAttribute("inert", "");
  // Premise (S32.5): the half sheet covers the lower part of the stage (bottom above 100 px), never a side.
  await expect.poll(async () => (await frame(page))[2]).toBeGreaterThan(100);
  const [top, right, , left] = await frame(page);
  expect([top, right, left]).toEqual([0, 0, 0]);
  const s = await spread(page);
  expect(s.width, JSON.stringify(s)).toBeGreaterThan(0.7);
});
