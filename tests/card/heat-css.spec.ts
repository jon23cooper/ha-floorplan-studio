import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";
import { TEXTURE_IDS } from "../../src/core/textures";
import type { Floor, Pt } from "../../src/core/schema";

// S34.7, finding 10 and criterion 12: the heat rule read as a string says nothing about specificity. Read the pixel back from
// Chromium in every theme: the heated room's fill is the ramp's colour mixed into the KIND's colour, and it beats the glow, a
// painted colour, a texture, the dark theme's paint dim and water's own rule. An unheated room in a heat mode is unchanged.
// The expected colour is written here as probes of the same tokens, not copied from the rule: t 0, 0.5 and 1 are the ramp's own ends.
const sq = (x: number, w = 100): Pt[] => [[x, 0], [x + w, 0], [x + w, 100], [x, 100]];
const NOW = "2026-10-17T10:00:00Z";
const reads = (id: string, v: string, unit: string) => [id, { state: v, attributes: { unit_of_measurement: unit }, last_changed: NOW }] as const;
const room = (i: number, name: string, extra: Record<string, unknown> = {}) => ({ id: `r${i}`, name, area: "", kind: "room", pts: sq(i * 120), wk: ["wall", "wall", "wall", "wall"], ...extra });
// Rooms, left to right: 0 t=0, 1 t=0.5, 2 t=1 (temperature 16, 21, 26); 3 glowing, 4 painted, 5 textured, 6 water, 7 garden, 8 no reading; 9 humidity 30 % (t=0), 10 humidity 70 % (t=1)
const floor = (): Floor => ({
  title: "T", outline: [[0, 0], [1320, 0], [1320, 100], [0, 100]], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [],
  devices: [{ id: "lamp", type: "light", entity: "light.lamp", name: "Lamp", x: 3 * 120 + 50, y: 50 }],
  rooms: [
    room(0, "A", { temps: ["t0"] }), room(1, "B", { temps: ["t1"] }), room(2, "C", { temps: ["t2"] }),
    room(3, "Glow", { temps: ["t1"] }), room(4, "Paint", { temps: ["t1"], color: "#dd2299" }), room(5, "Tex", { temps: ["t1"], texture: TEXTURE_IDS[0] }),
    room(6, "Water", { kind: "water", temps: ["t2"] }), room(7, "Garden", { kind: "garden", temps: ["t0"] }), room(8, "None"),
    room(9, "Dry", { humidity: ["h0"] }), room(10, "Wet", { humidity: ["h1"] }),
  ],
}) as unknown as Floor;
const STATE = Object.fromEntries([reads("t0", "16", "°C"), reads("t1", "21", "°C"), reads("t2", "26", "°C"), reads("h0", "30", "%"), reads("h1", "70", "%"), ["light.lamp", { state: "on", attributes: {}, last_changed: NOW }]]);
const probe = (css: string) => `<g class="probe"><path d="M0 0" style="fill:${css}"/></g>`;
const mix = (ramp: string, base: string) => `color-mix(in oklch,var(${ramp}) 55%,var(${base}))`;
const PROBES = [mix("--fp-heat-cool", "--fp-room-empty"), mix("--fp-heat-mid", "--fp-room-empty"), mix("--fp-heat-hot", "--fp-room-empty"), mix("--fp-heat-hot", "--fp-water"), mix("--fp-heat-cool", "--fp-garden"), mix("--fp-hum-dry", "--fp-room-empty"), mix("--fp-hum-wet", "--fp-room-empty"), "var(--fp-glow)", "#dd2299", "var(--fp-room-empty)", "var(--fp-water)"];
const [P0, P5, P1, PWATER, PGARDEN, HDRY, HWET, , PAINT] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const page_ = (heat: "temperature" | "humidity" | "off", theme: string, night = false) =>
  `<svg width="1400" height="200"><g data-theme="${theme}" data-mode="dark">${renderFloor(floor(), { scale: 1, theme: theme as never, state: STATE as never, roomGlow: true, dark: true, heat, night })}${PROBES.map(probe).join("")}</g></svg>`;
const html = (heats: Array<[string, string, boolean?]>) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style>${heats.map(([h, t, n]) => `<div id="${h}-${t}${n ? "-night" : ""}">${page_(h as never, t, n)}</div>`).join("")}</body></html>`;

type Read = { fill: string[]; filter: string[]; probes: string[] };
const read = (id: string) => (page: import("@playwright/test").Page) => page.locator(`#${id}`).evaluate((root) => {
  const polys = [...root.querySelectorAll("polygon[data-r]")] as SVGElement[];
  const probes = [...root.querySelectorAll(".probe path")] as SVGElement[];
  return { fill: polys.map((p) => getComputedStyle(p).fill), filter: polys.map((p) => getComputedStyle(p).filter), probes: probes.map((p) => getComputedStyle(p).fill) };
}) as Promise<Read>;

test("heat pair: a heated room's fill is the ramp mixed 55 % into the kind's colour at t 0, 0.5 and 1, differs from the same room off, in every theme", async ({ page }) => {
  await page.setContent(html(THEMES.flatMap((t) => [["temperature", t], ["off", t]] as Array<[string, string]>)));
  for (const t of THEMES) {
    const on = await read(`temperature-${t}`)(page), off = await read(`off-${t}`)(page);
    for (const v of [...on.fill, ...on.probes]) expect(v, t).toMatch(/^(rgb|color|oklch)\(/);
    expect(on.fill[0], `${t} t=0`).toBe(on.probes[P0]);
    expect(on.fill[1], `${t} t=0.5`).toBe(on.probes[P5]);
    expect(on.fill[2], `${t} t=1`).toBe(on.probes[P1]);
    expect(new Set([on.fill[0], on.fill[1], on.fill[2]]).size, `${t}: three different colours`).toBe(3);
    for (const i of [0, 1, 2]) expect(on.fill[i], `${t} ${i} differs from off`).not.toBe(off.fill[i]);
  }
});

test("heat pair: the heat beats the glow, a painted colour, a texture and water's own rule", async ({ page }) => {
  await page.setContent(html(THEMES.flatMap((t) => [["temperature", t], ["off", t]] as Array<[string, string]>)));
  for (const t of THEMES) {
    const on = await read(`temperature-${t}`)(page), off = await read(`off-${t}`)(page);
    expect(on.fill[3], `${t} glow: the lit room wears its heat`).toBe(on.probes[P5]);
    expect(off.fill[3], `${t} the same room off does glow`).not.toBe(on.probes[P5]);
    expect(on.fill[4], `${t} paint: the heat, not the colour`).toBe(on.probes[P5]);
    expect(on.fill[4], `${t} paint is not the pink`).not.toBe(on.probes[PAINT]);
    expect(on.filter[4], `${t} paint: no dim on a heated room`).toBe("none");
    expect(on.fill[5], `${t} texture: a colour, not a pattern`).toBe(on.probes[P5]);
    expect(on.fill[6], `${t} water: the ramp into water's blue`).toBe(on.probes[PWATER]);
    expect(on.fill[6], `${t} water differs from off`).not.toBe(off.fill[6]);
    expect(on.fill[7], `${t} garden: the ramp into the garden's green`).toBe(on.probes[PGARDEN]);
  }
});

test("heat pair: an unheated room in a heat mode is unchanged, and humidity has its own ramp", async ({ page }) => {
  await page.setContent(html(THEMES.flatMap((t) => [["temperature", t], ["humidity", t], ["off", t]] as Array<[string, string]>)));
  for (const t of THEMES) {
    const temp = await read(`temperature-${t}`)(page), hum = await read(`humidity-${t}`)(page), off = await read(`off-${t}`)(page);
    expect(temp.fill[8], `${t} no reading keeps its fill`).toBe(off.fill[8]);
    expect(temp.filter[8], t).toBe(off.filter[8]);
    for (const i of [9, 10]) expect(temp.fill[i], `${t} a humidity room is not a temperature room`).toBe(off.fill[i]);
    expect(hum.fill[9], `${t} dry`).toBe(hum.probes[HDRY]);
    expect(hum.fill[10], `${t} wet`).toBe(hum.probes[HWET]);
    expect(hum.fill[9], t).not.toBe(hum.fill[10]);
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) expect(hum.fill[i], `${t} a temperature room is not a humidity room`).toBe(off.fill[i]);
  }
});

test("heat pair: the night veil is not drawn in a heat mode, so a heated room is as light at night as by day", async ({ page }) => {
  await page.setContent(html([["temperature", "light", true], ["off", "light", true]]));
  const veil = (id: string) => page.locator(`#${id} .room-night`).count();
  expect(await veil("off-light-night")).toBeGreaterThan(0);
  expect(await veil("temperature-light-night")).toBe(0);
});
