import { test, expect, type Page } from "@playwright/test";
import { demo } from "./helpers-3d";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";
import { readSvg } from "../helpers/pixels";

// S23.8 (V13): light is light. A lit lamp's 2D glow is a radial falloff, brightest at the lamp and gone at its reach, clipped to
// the room it hangs in, screen-blended on a dark theme and multiplied on a light one. Read from real pixels (finding 16): the
// markup is renderFloor's own, on the plan's own stylesheet, at 1 cm = 1 px.

const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-08T10:00:00Z" });
// The demo's Kitchen is room 1 (500..800 x 0..400); its lamp moved to 60 cm off the shared wall with the Living room (x = 500),
// so the unclipped 150 cm circle would reach 90 cm into the Living room.
const LAMP = { id: "k", type: "light", entity: "light.k", x: 560, y: 200 };
const OFF = 50; // the viewBox starts at -50, so plan (x, y) is page (x + 50, y + 50)
const page_ = (theme: string, on: boolean) => {
  const [t, mode] = theme === "ha-dark" ? ["ha", "dark"] : [theme, "light"];
  const f = { ...structuredClone(demo.floors.ground), devices: [LAMP] };
  const svg = renderFloor(f as never, { scale: 1, state: { "light.k": st(on ? "on" : "off") } as never });
  return `<!DOCTYPE html><html><body style="margin:0"><style>${FLOORPLAN_CSS}</style><svg width="900" height="700" viewBox="-50 -50 900 700"><g data-theme="${t}" data-mode="${mode}" id="p">${svg}</g></svg></body></html>`;
};

/** The mean colour of a 6 x 6 px patch around plan point (x, y), the svg rasterised in the page (not page.screenshot). */
async function at(page: Page, x: number, y: number): Promise<number[]> {
  return (await readSvg(page, { svg: "svg", css: FLOORPLAN_CSS, client: true, patch: 6 }, [[x + OFF, y + OFF]]))[0];
}
const delta = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
// Plan points: just past the wall in the Living room, 90 cm from the lamp; the same distance inside the Kitchen; near the lamp
// (clear of its 24 cm disc); and 4/5 of the way to the reach.
const P = { outside: [470, 200], mirror: [650, 200], near: [590, 200], far: [560, 320] } as const;

for (const theme of ["light", "blueprint"]) {
  test(`${theme}: the glow stops at the lamp's room wall, and falls off from the lamp to its reach`, async ({ page }) => {
    const read = async (on: boolean) => {
      await page.setContent(page_(theme, on));
      return Object.fromEntries(await Promise.all(Object.entries(P).map(async ([k, [x, y]]) => [k, await at(page, x, y)] as const))) as Record<keyof typeof P, number[]>;
    };
    const off = await read(false), on = await read(true);
    expect(delta(on.mirror, off.mirror), "the same distance inside the room is lit").toBeGreaterThan(3);
    expect(delta(on.outside, off.outside), "just outside the room's wall: no glow").toBeLessThan(1);
    expect(delta(on.near, off.near), "near the lamp is brighter than near the reach").toBeGreaterThan(1.8 * delta(on.far, off.far));
  });
}

test("the glow blends by theme kind: screen on a dark theme, multiply on a light one, in every theme", async ({ page }) => {
  for (const theme of [...THEMES, "ha-dark"]) {
    await page.setContent(page_(theme, true));
    const got = await page.evaluate(() => {
      const aura = document.querySelector("#p circle.aura")!, x = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      x.fillStyle = getComputedStyle(document.querySelector("#p")!).getPropertyValue("--fp-bg").trim(); x.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(x.getImageData(0, 0, 1, 1).data).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return { blend: getComputedStyle(aura).mixBlendMode, bgLum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
    });
    expect(got.blend, `${theme} (background luminance ${got.bgLum.toFixed(2)})`).toBe(got.bgLum < 0.5 ? "screen" : "multiply");
  }
});
