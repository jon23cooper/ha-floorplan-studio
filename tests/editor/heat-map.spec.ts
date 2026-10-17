import { test, expect, type Page } from "@playwright/test";

// S34.10, spec H9 and criterion 14: the Studio's View menu has Heat map (Off, Temperature, Humidity). The pick is a
// viewer preference (View memory, not the layout, never an undo step). Inside Home Assistant the host sets `hassState`,
// which is what "the panel harness" is here: the same property the panel sets. Real page.mouse on real elements (finding 3).

const EDITOR = "floorplan-studio-editor";
const now = () => new Date().toISOString();
const reading = (state: string, unit: string) => ({ state, attributes: { unit_of_measurement: unit }, last_changed: now() });
// The first floor's Bathroom holds sensor.demo_bathroom_humidity; the ground floor's Living holds the temperature.
const STATES = () => ({
  "sensor.demo_bathroom_humidity": reading("54", "%"),
  "sensor.demo_living_temperature": reading("23.5", "°C"),
});

const click = async (page: Page, sel: string) => {
  const b = (await page.locator(`${EDITOR} ${sel}`).boundingBox())!;
  expect(b, `${sel} has a box`).not.toBeNull();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};
const isOpen = (page: Page, sel: string) => page.evaluate(([tag, s]) => (document.querySelector(tag) as any).shadowRoot.querySelector(s).open, [EDITOR, sel]);
async function pick(page: Page, kind: "off" | "temperature" | "humidity") {
  if (!(await isOpen(page, "#mOpt"))) await click(page, "#mOpt > summary");
  if (!(await isOpen(page, "#heatSub"))) await click(page, "#heatSub > summary");
  await click(page, `#heatSub button[data-heat="${kind}"]`);
}
async function open(page: Page, states = false) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  if (states) await page.evaluate(([tag, s]) => { (document.querySelector(tag) as any).hassState = s; }, [EDITOR, STATES()] as const);
}
const heated = (page: Page) => page.locator(`${EDITOR} svg polygon.room.heat`);
const status = (page: Page) => page.locator(`${EDITOR} #statusBar`);

test("View menu: a Heat map group with Off, Temperature and Humidity; Off at start", async ({ page }) => {
  await open(page);
  await click(page, "#mOpt > summary");
  await click(page, "#heatSub > summary");
  const kinds = await page.locator(`${EDITOR} #heatSub button[data-heat]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-heat")));
  expect(kinds).toEqual(["off", "temperature", "humidity"]);
  await expect(page.locator(`${EDITOR} #heatSub button[data-heat="off"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(heated(page)).toHaveCount(0);
  await expect(status(page)).not.toContainText("Heat map");
});

test("inside Home Assistant: Heat map, Humidity heats the bathroom and the status bar draws the scale", async ({ page }) => {
  await open(page, true);
  await click(page, '[data-f="first"]');
  await pick(page, "humidity");
  await expect(heated(page)).toHaveCount(1);
  await expect(page.locator(`${EDITOR} svg text.heat-val`)).toContainText("54 %");
  await expect(status(page)).toContainText("Heat map: 30 % to 70 %");
  await pick(page, "temperature");
  await expect(status(page), "no temperature sensor on the first floor").toContainText("Heat map: no readings");
  await click(page, '[data-f="ground"]');
  await expect(page.locator(`${EDITOR} svg text.heat-val`)).toContainText("23.5 °C");
  await expect(status(page)).toContainText("Heat map: 16 °C to 26 °C");
  await pick(page, "off");
  await expect(heated(page)).toHaveCount(0);
});

test("standalone: no states, so no room is heated and the status bar says no readings", async ({ page }) => {
  await open(page);
  await pick(page, "temperature");
  await expect(heated(page)).toHaveCount(0);
  await expect(status(page)).toContainText("Heat map: no readings");
});

test("the pick survives a reload and a hass update, and is not an undo step", async ({ page }) => {
  await open(page, true);
  await click(page, '[data-f="first"]');
  const undoBefore = await page.locator(`${EDITOR} #undo`).isDisabled();
  await pick(page, "humidity");
  expect(await page.locator(`${EDITOR} #undo`).isDisabled(), "undo stack untouched").toBe(undoBefore);
  await page.evaluate(([tag, s]) => { (document.querySelector(tag) as any).hassState = s; }, [EDITOR, STATES()] as const);
  await expect(heated(page), "a hass update keeps the mode").toHaveCount(1);
  // The memory is written after a short delay; wait for it by what it holds, never by time.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorplan-studio:view") ?? "")).toContain("humidity");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate(([tag, s]) => { (document.querySelector(tag) as any).hassState = s; }, [EDITOR, STATES()] as const);
  await click(page, "#mOpt > summary");
  await click(page, "#heatSub > summary");
  await expect(page.locator(`${EDITOR} #heatSub button[data-heat="humidity"]`)).toHaveAttribute("aria-pressed", "true");
});

test("junk in storage: the Studio opens with the heat map off", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("floorplan-studio:view", JSON.stringify({ v: 1, heat: "<b>lava</b>" })); } catch { /* none */ } });
  await open(page, true);
  await expect(heated(page)).toHaveCount(0);
  await click(page, "#mOpt > summary");
  await click(page, "#heatSub > summary");
  await expect(page.locator(`${EDITOR} #heatSub button[data-heat="off"]`)).toHaveAttribute("aria-pressed", "true");
});

test("S34 review m3: the status bar ramp blends in oklch, as the card's legend does", async ({ page }) => {
  await open(page, true);
  await pick(page, "temperature");
  const ramp = page.locator(`${EDITOR} #statusBar .sb-ramp`);
  await expect(ramp).toBeVisible();
  // Computed, not the attribute: the browser keeps the interpolation space in the parsed image.
  const img = await ramp.evaluate((e) => getComputedStyle(e).backgroundImage);
  expect(img).toContain("oklch");
});
