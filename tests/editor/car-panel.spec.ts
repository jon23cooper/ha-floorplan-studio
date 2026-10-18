import { test, expect, type Page } from "@playwright/test";
import { haData, type PickerHass } from "../../src/editor/hass-pickers";
import { CAR_MODELS, validate, type Floor, type Layout } from "../../src/core/schema";
import { CAR_SPEC } from "../../src/core";

// S35.7, spec criterion 16: the Studio's car block with real clicks. One undo step each, none for an unchanged value,
// `validate` after every step and after Undo and Redo. The panel reads Home Assistant through `haData` exactly as the
// card's host does; the registry rows below have the shape of `EntityReg` in `src/editor/hass-pickers.ts` (the sender).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const carOf = async (page: Page) => (await groundOf(page)).furniture[0] as unknown as Record<string, unknown>;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const center = async (page: Page, sel: string) => { await page.locator(sel).scrollIntoViewIfNeeded(); const b = (await page.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const click = async (page: Page, sel: string) => { const c = await center(page, sel); await page.mouse.click(c.x, c.y); };
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };
const redo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+Shift+z"); };
const valid = async (page: Page, what: string) => {
  const l = await layoutOf(page), r = validate(l);
  expect(r.ok, `${what}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
};
/** Does `act`, then Undo and Redo, and expects exactly one step each way and a valid layout throughout. */
async function oneStep(page: Page, what: string, act: () => Promise<void>) {
  const before = JSON.stringify(await layoutOf(page));
  await act();
  const after = JSON.stringify(await layoutOf(page));
  expect(after, `${what}: changed`).not.toBe(before);
  await valid(page, `${what} (done)`);
  await undo(page);
  expect(JSON.stringify(await layoutOf(page)), `${what}: one Undo takes it all back`).toBe(before);
  await valid(page, `${what} (undone)`);
  await redo(page);
  expect(JSON.stringify(await layoutOf(page)), `${what}: Redo`).toBe(after);
  await valid(page, `${what} (redone)`);
  await reselect(page);
}
/** Undo and Redo clear the selection (as they do for every edit); the car is picked again with a real click. */
const reselect = async (page: Page) => { if (!(await page.locator("#fcm").count())) { await clickCm(page, 500, 450); await expect(page.locator("#fcm")).toBeVisible(); } };
/** Does `act` and expects nothing to change and no step to exist. */
async function noStep(page: Page, what: string, act: () => Promise<void>) {
  const before = JSON.stringify(await layoutOf(page));
  await act();
  expect(JSON.stringify(await layoutOf(page)), what).toBe(before);
}

// Home Assistant, as the registries answer: one device ("Model 3") groups four of the car's entities; one more belongs to another device.
const REG = [
  { entity_id: "device_tracker.m3_location", device_id: "dev-m3", original_name: "Model 3 location" },
  { entity_id: "sensor.m3_battery", device_id: "dev-m3", original_name: "Model 3 battery", original_device_class: "battery" },
  { entity_id: "binary_sensor.m3_charging", device_id: "dev-m3", original_name: "Model 3 charging", original_device_class: "battery_charging" },
  { entity_id: "sensor.m3_wifi", device_id: "dev-m3", original_name: "Model 3 wifi", entity_category: "diagnostic" },
  { entity_id: "lock.house_door", device_id: "dev-house", original_name: "Tesla door lock" },
  { entity_id: "sensor.garage_temp", device_id: "dev-house", original_name: "Garage temperature" },
  { entity_id: "input_number.target", original_name: "Target" },
];
const STATES = Object.fromEntries(REG.map((r) => [r.entity_id, { state: "on", attributes: {} }]));
const FAKE_HASS: PickerHass = { states: STATES, callWS: async <T>({ type }: { type: string }) => (type === "config/entity_registry/list" ? REG : type === "config/device_registry/list" ? [{ id: "dev-m3", name: "Model 3" }, { id: "dev-house", name: "House" }] : []) as T };

const floorOf = (extra: Partial<Floor>): Floor => ({ title: "Ground", outline: [[0, 0], [1200, 0], [1200, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...extra } as Floor);
const CAR = { id: "furniture-ground-1", symbol: "car", x: 500, y: 450, rot: 0, w: 470, h: 182, name: "Tesla" };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg`).first()).toBeVisible();
  const ha = await haData(FAKE_HASS);
  await page.evaluate(([tag, f, h]) => {
    const el = document.querySelector(tag as string) as any;
    el.layout = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: f } };
    el.ha = h;
  }, [EDITOR, floorOf({
    furniture: [CAR] as never,
    devices: [{ id: "device-ground-1", name: "Golf", type: "car", entity: "device_tracker.m3_location", x: 150, y: 150 }] as never,
    unlinked: [{ id: "unlinked-ground-1", type: "car", name: "Old pickup", x: 900, y: 150, rot: 90, scale: 1, color: "#aa5500", attached: ["sensor.m3_battery", "sensor.garage_temp"] }] as never,
  }), ha] as const);
  await clickCm(page, 500, 450);
  await expect(page.locator("#fcm")).toBeVisible();
});

test("the Car block is on a car piece and on no other piece", async ({ page }) => {
  await expect(page.locator("#fccol")).toBeVisible();
  await expect(page.locator("#fuattach")).toBeVisible();
  await page.locator("#fs").selectOption("sofa");
  await expect(page.locator("#fcm")).toHaveCount(0);
  expect(await carOf(page)).not.toHaveProperty("model");
});

test("leaving the car symbol takes model, colour and attached along, so the layout still validates", async ({ page }) => {
  await page.locator("#fcm").selectOption("truck");
  await click(page, "#fccx"); // no colour yet: no step
  await page.locator("#fccol").fill("#336699");
  await valid(page, "a truck, painted");
  await page.locator("#fs").selectOption("sofa");
  expect(await carOf(page)).not.toHaveProperty("model");
  expect(await carOf(page)).not.toHaveProperty("color");
  await valid(page, "a sofa");
});

test("every model: footprint set, typed height gone, one undo step; the same model again is no step", async ({ page }) => {
  await page.locator("#fuht").fill("400");
  await page.locator("#fuht").press("Enter");
  expect((await carOf(page)).height).toBe(400);
  for (const model of CAR_MODELS.filter((m) => m !== "sedan")) {
    await oneStep(page, model, async () => { await page.locator("#fcm").selectOption(model); });
    await page.locator("#fcm").selectOption(model);
    const c = await carOf(page);
    expect(c, model).toMatchObject({ model, w: CAR_SPEC[model].w, h: CAR_SPEC[model].h });
    expect(c).not.toHaveProperty("height");
    await page.locator("#fuht").fill("400"); await page.locator("#fuht").press("Enter"); // typed again for the next model
  }
  await page.locator("#fcm").selectOption("suv");
  await noStep(page, "suv again", async () => { await page.locator("#fcm").selectOption("suv"); });
});

test("the swatch draws the model's own silhouette: the truck has a bed, the sedan has not", async ({ page }) => {
  const parts = () => page.locator("#fcsw").evaluate((svg) => ({ bed: svg.querySelectorAll(".car-bed").length, glass: svg.querySelectorAll(".car-glass").length, ratio: svg.getBoundingClientRect().width / svg.getBoundingClientRect().height }));
  const sedan = await parts();
  expect(sedan.bed).toBe(0);
  expect(sedan.glass).toBeGreaterThan(0);
  await page.locator("#fcm").selectOption("truck");
  const truck = await parts();
  expect(truck.bed).toBe(1);
  expect(truck.ratio).toBeCloseTo(CAR_SPEC.truck.w / CAR_SPEC.truck.h, 1); // asymmetric: the truck is longer than the sedan
  expect(truck.ratio).toBeGreaterThan(sedan.ratio);
  expect(await page.locator("#fcsw").getAttribute("aria-label")).toBe("Pickup truck, seen from above");
});

test("colour: a palette swatch, a typed colour that joins the palette, and Theme colour, each one step", async ({ page }) => {
  const swatches = page.locator('[aria-label="Car colours"] .sw');
  await oneStep(page, "palette swatch", async () => { await swatches.first().click(); });
  expect(typeof (await carOf(page)).color).toBe("string");
  await oneStep(page, "custom colour", async () => { await page.locator("#fccol").fill("#12ab34"); });
  await page.locator("#fccol").fill("#12ab34");
  expect((await carOf(page)).color).toBe("#12ab34");
  expect((await layoutOf(page)).palette).toEqual(["#12ab34"]);
  await expect(page.locator('[aria-label="Car colours"] .sw.custom')).toHaveCount(1);
  await noStep(page, "the same colour again", async () => { await page.locator("#fccol").fill("#12ab34"); });
  await oneStep(page, "Theme colour", async () => { await click(page, "#fccx"); });
  expect(await carOf(page)).not.toHaveProperty("color");
  await noStep(page, "Theme colour with none", async () => { await click(page, "#fccx"); });
});

test("main entity: trackers are listed first and the pick is one step", async ({ page }) => {
  await page.locator("#fuent input").click();
  const groups = await page.locator("#fuent li.grouphead").allTextContents();
  expect(groups[0].toLowerCase()).toBe("device_tracker");
  expect(groups.length).toBeGreaterThan(2);
  await page.keyboard.press("Escape");
  await oneStep(page, "main entity", async () => {
    await page.locator("#fuent input").click();
    await page.locator("#fuent li[role='option'][data-value='device_tracker.m3_location']").click();
  });
  expect((await carOf(page)).entity).toBe("device_tracker.m3_location");
});

test("attached: the main entity's device comes first, then the name, then car domains; diagnostics last", async ({ page }) => {
  await page.locator("#fuent input").click();
  await page.locator("#fuent li[role='option'][data-value='device_tracker.m3_location']").click();
  await page.locator("#fuattach input").click();
  expect(await page.locator("#fuattach li.grouphead").allTextContents()).toEqual(["This car's device", "Named like this car", "Car entities", "Other", "Diagnostic"]);
  const order = (await page.locator("#fuattach li[role='option']").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")))).filter(Boolean); // the empty "add..." row is no entity
  expect(order).toEqual(["sensor.m3_battery", "binary_sensor.m3_charging", "lock.house_door", "sensor.garage_temp", "input_number.target", "sensor.m3_wifi"]);
  await page.keyboard.press("Escape");
  await oneStep(page, "attach one", async () => {
    await page.locator("#fuattach input").click();
    await page.locator("#fuattach li[role='option'][data-value='sensor.m3_battery']").click();
  });
  expect((await carOf(page)).attached).toEqual(["sensor.m3_battery"]);
  await oneStep(page, "remove one", async () => { await click(page, "#fuattach-rm0"); });
  expect(await carOf(page)).not.toHaveProperty("attached");
});

test("Add all from this car: the device's entities, one undo step; the button is gone when nothing is left", async ({ page }) => {
  await expect(page.locator("#fuall")).toHaveCount(0); // no main entity yet: no device to add from
  await page.locator("#fuent input").click();
  await page.locator("#fuent li[role='option'][data-value='device_tracker.m3_location']").click();
  await expect(page.locator("#fuall")).toContainText("(3)");
  await oneStep(page, "add all", async () => { await click(page, "#fuall"); });
  expect((await carOf(page)).attached).toEqual(["sensor.m3_battery", "binary_sensor.m3_charging", "sensor.m3_wifi"]); // by name, diagnostic last
  await expect(page.locator("#fuall")).toHaveCount(0);
});

test("Convert to car piece: a device car becomes a sedan piece, one step", async ({ page }) => {
  await clickCm(page, 150, 150);
  await expect(page.locator("#fuconv")).toBeVisible();
  await oneStep(page, "convert device", async () => { await click(page, "#fuconv"); await expect(page.locator("#fcm")).toBeVisible(); }); // the new piece is selected and shows its Car block
  const g = await groundOf(page);
  expect(g.devices).toHaveLength(0);
  expect(g.furniture[1]).toMatchObject({ symbol: "car", x: 150, y: 150, name: "Golf", entity: "device_tracker.m3_location", w: 470, h: 182 });
});

test("Convert to car piece: an unlinked car keeps its turn, colour and attached", async ({ page }) => {
  await clickCm(page, 900, 150);
  await oneStep(page, "convert unlinked", async () => { await click(page, "#fuconv"); });
  const g = await groundOf(page);
  expect(g.unlinked).toHaveLength(0);
  expect(g.furniture[1]).toMatchObject({ symbol: "car", x: 900, y: 150, rot: 90, name: "Old pickup", color: "#aa5500", attached: ["sensor.m3_battery", "sensor.garage_temp"] });
});

test("Convert is offered on a car and on nothing else", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices.push({ id: "device-ground-2", name: "Lamp", type: "light", entity: "light.lamp", x: 700, y: 150 });
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 700, 150);
  await expect(page.locator("#vdel")).toBeVisible();
  await expect(page.locator("#fuconv")).toHaveCount(0);
});
