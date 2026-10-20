import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// task/card-gaps: G9 (display text from hass.formatEntityState), G11 (a failed service call tells the user) and G12
// (popup buttons for script, scene, button, valve). Clicks are real page.mouse events at the centre of an icon that is
// checked to be the real top element (CLAUDE.md finding 3). Shapes copied from card-popup.spec.ts: callService(domain, service, data).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = () => ({
  "light.demo_living": st("on", { friendly_name: "Living light", brightness: 128 }),
  "light.demo_kitchen": st("on", { supported_color_modes: ["onoff"] }),
  "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "sensor.demo_living_temperature": st("21.456789", { unit_of_measurement: "°C" }),
  "climate.demo_living": st("heat_cool"), "camera.demo_hall": st("idle"),
});

/** `hassSrc` is the source of a function (states, w) => hass, evaluated in the page, so a stub can reject or format. */
async function boot(page: Page, hassSrc: string, layout: unknown = structuredClone(demo), states: Record<string, unknown> = STATES(), extra: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states, src]) => {
    const w = window as unknown as { __calls: string[]; __notes: string[]; __unhandled: string[] };
    w.__calls = []; w.__notes = []; w.__unhandled = [];
    window.addEventListener("unhandledrejection", (e) => w.__unhandled.push(String(e.reason)));
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-notification", (e) => w.__notes.push((e as CustomEvent).detail.message));
    el.setConfig(config);
    el.hass = (new Function("states", "w", `return (${src})(states, w)`))(states, w);
    return el.updateComplete;
  }, [{ layout, floor: "ground", ...extra }, states, hassSrc] as const);
  await card(page).evaluate((el) => el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse[aria-expanded=true]")?.click());
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const win = <T,>(page: Page, k: string) => page.evaluate((k) => (window as unknown as Record<string, T>)[k], k);
const pop = (page: Page) => card(page).locator("css=.fp-pop");
const OK = `(states, w) => ({ states, callService: (d, s, data) => { w.__calls.push(d + "." + s + " " + JSON.stringify(data)); } })`;

async function tapIcon(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-x="${i}"]`)!;
    const r = g.getBoundingClientRect();
    let x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    for (let a = 1; a < 8 && !top?.closest(`g[data-x="${i}"]`); a++) for (let b = 1; b < 8 && !top?.closest(`g[data-x="${i}"]`); b++) {
      x = r.x + (r.width * a) / 8; y = r.y + (r.height * b) / 8; top = el.shadowRoot!.elementFromPoint(x, y);
    }
    return { x, y, hit: !!top?.closest(`g[data-x="${i}"]`) };
  }, i);
  expect(p.hit, `device ${i} is the top element at its centre`).toBe(true);
  await page.mouse.click(p.x, p.y);
}
// ground devices: 0 living light, 1 kitchen light, 2 hall switch, 3 TV plug, 4 temperature sensor, 6 camera

test.describe("G11 a failed service call tells the user", () => {
  const REJECT = `(states, w) => ({ states, callService: (d, s, data) => { w.__calls.push(d + "." + s + " " + JSON.stringify(data)); return Promise.reject(new Error("Service not found")); } })`;
  const THROW = `(states, w) => ({ states, callService: (d, s, data) => { w.__calls.push(d + "." + s); throw new Error("sync boom"); } })`;
  test("a rejected call fires hass-notification with the message and leaves no unhandled rejection; the call keeps its shape", async ({ page }) => {
    await boot(page, REJECT);
    await tapIcon(page, 2); // hall switch, off: Turn on
    await pop(page).locator("css=.fp-pop-do").click();
    await expect.poll(() => win<string[]>(page, "__notes")).toEqual(["switch.turn_on: Service not found"]);
    expect(await win<string[]>(page, "__calls")).toEqual(['switch.turn_on {"entity_id":"switch.demo_hall"}']);
    await page.waitForTimeout(100);
    expect(await win<string[]>(page, "__unhandled")).toEqual([]);
  });
  test("a call that throws at once is caught the same way", async ({ page }) => {
    await boot(page, THROW);
    await tapIcon(page, 2);
    await pop(page).locator("css=.fp-pop-do").click();
    await expect.poll(() => win<string[]>(page, "__notes")).toEqual(["switch.turn_on: sync boom"]);
  });
  test("a call that works fires no notification", async ({ page }) => {
    await boot(page, OK);
    await tapIcon(page, 2);
    await pop(page).locator("css=.fp-pop-do").click();
    await expect.poll(() => win<string[]>(page, "__calls")).toHaveLength(1);
    await page.waitForTimeout(100);
    expect(await win<string[]>(page, "__notes")).toEqual([]);
  });
});

test.describe("G9 display text from hass.formatEntityState", () => {
  const FMT = `(states, w) => ({ states, formatEntityState: (s) => "FMT<" + s.state + ">", callService: () => {} })`;
  test("the plan reading and the popup line use the host's text", async ({ page }) => {
    await boot(page, FMT);
    await expect(card(page).locator("css=svg text.val").first()).toHaveText("FMT<21.456789>");
    await tapIcon(page, 4);
    await expect(pop(page).locator("css=.fp-pop-state")).toHaveText("FMT<21.456789>");
  });
  test("an old frontend without formatEntityState keeps the raw path", async ({ page }) => {
    await boot(page, OK);
    await expect(card(page).locator("css=svg text.val").first()).toHaveText("21.456789 °C");
  });
});
