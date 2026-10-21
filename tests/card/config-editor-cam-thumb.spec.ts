import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S16.3: the card's visual config editor has the three camera thumbnail choices. Same harness as config-editor-walls.spec.ts.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/config-editor-harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

async function mount(page: Page, config: Record<string, unknown>) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => Promise.all([customElements.whenDefined("floorplan-studio-card"), customElements.whenDefined("floorplan-studio-card-editor")]));
  await page.evaluate((config) => {
    const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): HTMLElement };
    const el = Ctor.getConfigElement();
    (window as unknown as { __events: unknown[] }).__events = [];
    el.addEventListener("config-changed", (e) => (window as unknown as { __events: unknown[] }).__events.push((e as CustomEvent).detail));
    el.id = "editor";
    document.body.appendChild(el);
    (el as unknown as { setConfig(c: unknown): void }).setConfig(config);
  }, config);
}
const last = async (page: Page) => ((await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events)).at(-1) as { config: Record<string, unknown> }).config;

test("camera thumbnail rows: off, medium, below at start; a real click and the selects write the YAML; defaults are left out", async ({ page }) => {
  await mount(page, { layout: demo });
  const ed = page.locator("#editor");
  await expect(ed.locator("input#camera_thumb")).not.toBeChecked();
  await expect(ed.locator("select#camera_thumb_size")).toHaveValue("medium");
  await expect(ed.locator("select#camera_thumb_pos")).toHaveValue("below");
  expect(await ed.locator("select#camera_thumb_size option").allTextContents()).toEqual(["Small", "Medium", "Large"]);
  expect(await ed.locator("select#camera_thumb_pos option").allTextContents()).toEqual(["Above", "Below", "Left", "Right"]);
  await ed.locator("input#camera_thumb").click();
  expect((await last(page)).camera_thumb).toBe("on");
  await ed.locator("select#camera_thumb_size").selectOption("large");
  expect((await last(page)).camera_thumb_size).toBe("large");
  await ed.locator("select#camera_thumb_pos").selectOption("right");
  expect((await last(page)).camera_thumb_pos).toBe("right");
  await ed.locator("select#camera_thumb_size").selectOption("medium");
  expect("camera_thumb_size" in (await last(page))).toBe(false);
  await ed.locator("input#camera_thumb").click();
  expect("camera_thumb" in (await last(page))).toBe(false);
});

test("the rows read the YAML, a YAML boolean true too, and junk shows the defaults", async ({ page }) => {
  await mount(page, { layout: demo, camera_thumb: true, camera_thumb_size: "small", camera_thumb_pos: "left" });
  await expect(page.locator("#editor input#camera_thumb")).toBeChecked();
  await expect(page.locator("#editor select#camera_thumb_size")).toHaveValue("small");
  await expect(page.locator("#editor select#camera_thumb_pos")).toHaveValue("left");
  await mount(page, { layout: demo, camera_thumb: "<b>", camera_thumb_size: "huge", camera_thumb_pos: 7 });
  await expect(page.locator("#editor input#camera_thumb")).not.toBeChecked();
  await expect(page.locator("#editor select#camera_thumb_size")).toHaveValue("medium");
  await expect(page.locator("#editor select#camera_thumb_pos")).toHaveValue("below");
});
