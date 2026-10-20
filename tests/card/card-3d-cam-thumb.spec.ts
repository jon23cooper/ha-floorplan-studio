import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, holder, drawn } from "./helpers-3d";

// S16.3: the camera thumbnail in the 3D card, an <img> in the overlay beside the camera's icon. A real page.mouse tap (finding 3).
// The hass stub has Home Assistant's shape (finding 21). The static server answers an unknown path with 404, which is the failed load.
// Demo ground floor: the Hall camera `camera.demo_hall`.

const PIC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; // one valid pixel
const PATH = "/api/camera_proxy/camera.demo_hall?token=abc";
const cam = (pic: string, state = "idle") => ({ "camera.demo_hall": { state, attributes: { entity_picture: pic }, last_changed: "2026-10-21T09:30:15Z" } });

async function boot(page: Page, config: Record<string, unknown>, states: Record<string, unknown> = cam(PIC)) {
  const seen = await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([cfg, s]) => {
    const w = window as unknown as { __info: string[] };
    w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    el.setConfig(cfg);
    el.hass = { states: s, callService() {} };
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", view: "3d", ...config }, states] as const);
  await drawn(page);
  return seen;
}
const img = (page: Page) => card(page).locator("css=img.fp3-cam");
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);

test.describe("S16.3 camera thumbnail, 3D", () => {
  test("a picture beside the camera icon, inside the stage; a real tap on it opens more-info for the camera", async ({ page }) => {
    await boot(page, { camera_thumb: "on" });
    await expect(img(page)).toHaveCount(1);
    await expect(img(page)).toHaveAttribute("src", PIC);
    await expect(img(page)).toBeVisible();
    const b = (await img(page).boundingBox())!, s = (await holder(page).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(s.x);
    expect(b.y).toBeGreaterThanOrEqual(s.y);
    expect(b.x + b.width).toBeLessThanOrEqual(s.x + s.width);
    expect(b.y + b.height).toBeLessThanOrEqual(s.y + s.height);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect.poll(() => infos(page)).toEqual(["camera.demo_hall"]);
  });

  test("off: no picture element and no request for it", async ({ page }) => {
    const seen = await boot(page, {}, cam(PATH));
    await page.waitForTimeout(300);
    await expect(img(page)).toHaveCount(0);
    expect(seen.filter((u) => u.includes("camera_proxy"))).toEqual([]);
  });

  test("on asks for the picture with a cache buster", async ({ page }) => {
    const seen = await boot(page, { camera_thumb: "on" }, cam(PATH));
    await expect.poll(() => seen.filter((u) => u.includes("camera_proxy")).length).toBeGreaterThan(0);
    expect(seen.find((u) => u.includes("camera_proxy"))).toMatch(/token=abc&fp_t=\d+$/);
  });

  test("an unavailable camera has no picture", async ({ page }) => {
    await boot(page, { camera_thumb: "on" }, cam(PIC, "unavailable"));
    await expect(img(page)).toHaveCount(0);
  });

  test("a picture that fails to load is hidden, not drawn broken", async ({ page }) => {
    await boot(page, { camera_thumb: "on" }, cam(PATH));
    await expect(img(page)).toBeHidden();
  });

  test("size changes the box: large is wider than small", async ({ page }) => {
    await boot(page, { camera_thumb: "on", camera_thumb_size: "small" });
    const small = (await img(page).boundingBox())!;
    await boot(page, { camera_thumb: "on", camera_thumb_size: "large" });
    const large = (await img(page).boundingBox())!;
    expect(large.width).toBeGreaterThan(1.8 * small.width);
  });

  test("the CSS reaches the pixel: a bordered plate that covers its box", async ({ page }) => {
    await boot(page, { camera_thumb: "on" });
    const s = await img(page).evaluate((el) => {
      const c = getComputedStyle(el);
      return { position: c.position, fit: c.objectFit, border: c.borderTopWidth };
    });
    // The overlay layer lets events through to the canvas; the tap is the view's own hit test (hitCam), proved by the tap test above.
    expect(s).toMatchObject({ position: "absolute", fit: "cover", border: "1px" });
  });
});
