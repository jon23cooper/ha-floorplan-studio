import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";
import { carTop } from "../../src/core/car";

// S35.4, spec C5 and C7, criterion 7, finding 10: a rule read as a string says nothing about specificity. Every rule that matters is read back
// from Chromium as a computed colour in every theme, against a probe of the token it must wear. Remove a rule and its test fails.
const car = (cls: string, style = "") => `<g class="furn furn-car ${cls}" ${style ? `style="${style}"` : ""}>${carTop("truck")}</g>`;
const prism = `<g class="furn furn-car"><polygon class="bs" points="0,0 1,0 1,1"/><polygon class="bs w" points="0,0 1,0 1,1"/><g class="car-cabin"><polygon class="bs" points="0,0 1,0 1,1"/><polygon class="bt" points="0,0 1,0 1,1"/></g></g>`;
const marks = `<g class="car-marks"><circle class="away-mark" r="8"/><g class="car-bolt"><circle r="10"/><path d="M0 0"/></g></g>`;
const probe = (v: string) => `<g class="probe" style="fill:var(${v})"><path d="M0 0"/></g>`;
const plan = (body: string) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`;
const BODY = `${car("")}${car("", "--fp-car-body:#c03030")}${car("away")}${car("charging")}${car("alert")}${car("charging alert")}${probe("--fp-furniture")}${probe("--fp-dev-car")}${probe("--fp-open-door")}${probe("--fp-ink")}${prism}${marks}${probe("--fp-idle")}`;

type R = Record<string, string>;
const read = (page: import("@playwright/test").Page, t: string) => page.locator(`#t-${t}`).evaluate((g): R => {
  const c = Array.from(g.children);
  const fill = (e: Element | null) => getComputedStyle(e!).fill, stroke = (e: Element | null) => getComputedStyle(e!).stroke;
  const body = (i: number) => c[i].querySelector(".car-body");
  const bs = c[10].querySelectorAll(".bs"), cabin = c[10].querySelector(".car-cabin")!;
  return {
    plain: fill(body(0)), paint: fill(body(1)), furniture: fill(c[6].querySelector("path")), plainStroke: stroke(body(0)), ink: fill(c[9].querySelector("path")),
    homeOpacity: getComputedStyle(c[0]).opacity, awayOpacity: getComputedStyle(c[2]).opacity,
    chargingStroke: stroke(body(3)), alertStroke: stroke(body(4)), bothStroke: stroke(body(5)), devCar: fill(c[7].querySelector("path")), openDoor: fill(c[8].querySelector("path")),
    glass: fill(c[0].querySelector(".car-glass")), tyre: fill(c[0].querySelector(".car-tyre")), grille: fill(c[0].querySelector(".car-grille")),
    roof: fill(c[0].querySelector(".car-roof")), bed: fill(c[0].querySelector(".car-bed")),
    side: fill(bs[0]), sideW: fill(bs[1]), cabinSide: fill(cabin.querySelector(".bs")), cabinLid: fill(cabin.querySelector(".bt")),
    awayMark: fill(c[11].querySelector(".away-mark")), bolt: fill(c[11].querySelector(".car-bolt circle")), idle: fill(c[12].querySelector("path")),
    paintStroke: stroke(body(1)),
  };
});
const lum = (rgb: string) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

test("car body: the piece's colour, and the theme's furniture colour without it", async ({ page }) => {
  await page.setContent(plan(BODY));
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.paint, `${t}: --fp-car-body wins`).toBe("rgb(192, 48, 48)");
    expect(r.plain, `${t}: no colour is the furniture colour`).toBe(r.furniture);
    expect(r.plain, `${t}: and not the paint`).not.toBe(r.paint);
    expect(r.roof, `${t}: the roof is a darker body`).not.toBe(r.plain);
    expect(r.bed, `${t}: so is the bed`).not.toBe(r.plain);
  }
});

test("car glass, tyres and grille are near-black in every theme, never themed light", async ({ page }) => {
  await page.setContent(plan(BODY));
  for (const t of THEMES) {
    const r = await read(page, t);
    for (const k of ["glass", "tyre", "grille"]) expect(lum(r[k]), `${t} ${k} ${r[k]}`).toBeLessThan(0.15);
  }
});

test("car away: the group is at 35 %, home is not", async ({ page }) => {
  await page.setContent(plan(BODY));
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.awayOpacity, t).toBe("0.35");
    expect(r.homeOpacity, t).toBe("1");
  }
});

test("car charging strokes the outline in --fp-dev-car, an alert in --fp-open-door, and charging beats alert", async ({ page }) => {
  await page.setContent(plan(BODY));
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.chargingStroke, `${t}: charging`).toBe(r.devCar);
    expect(r.alertStroke, `${t}: alert`).toBe(r.openDoor);
    expect(r.bothStroke, `${t}: charging wins`).toBe(r.devCar);
    expect(r.plainStroke, `${t}: rest is the ink`).toBe(r.ink);
    expect(r.devCar, `${t}: the two colours differ`).not.toBe(r.openDoor);
    expect(r.devCar, `${t}: the charge light is a colour`).toMatch(/^rgb\(/);
  }
});

test("car 2.5D: body sides take the paint, the cabin's sides are glass and its lid a darker body", async ({ page }) => {
  await page.setContent(plan(BODY));
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.cabinSide, `${t}: cabin sides are the near-black glass`).toBe(r.glass);
    expect(r.side, `${t}: body side is not the glass`).not.toBe(r.glass);
    expect(r.sideW, `${t}: the wide side differs from the narrow`).not.toBe(r.side);
    expect(r.cabinLid, `${t}: the roof lid`).toBe(r.roof);
  }
});

test("car badges: the away mark is idle grey, the bolt disc is --fp-dev-car", async ({ page }) => {
  await page.setContent(plan(BODY));
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.awayMark, t).toBe(r.idle);
    expect(r.bolt, t).toBe(r.devCar);
  }
});

// Review finding 3: in 2.5D the marks were inside the faded group, so an away car's dot drew at 35 % of 100 %. The effective opacity
// is the product up the tree; the pair is the nested control, which must read 0.35 so the test can tell the two apart.
test("car away 2.5D: the away dot is drawn at full strength, beside the faded car, not inside it", async ({ page }) => {
  const mark = `<g class="car-marks"><circle class="away-mark" r="8"/></g>`;
  const sibling = `<g id="sib"><g class="furn furn-car away"><polygon class="bs" points="0,0 1,0 1,1"/></g>${mark}</g>`;
  const nested = `<g id="nest"><g class="furn furn-car away"><polygon class="bs" points="0,0 1,0 1,1"/>${mark}</g></g>`;
  await page.setContent(`<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg><g data-theme="light" data-mode="light">${sibling}${nested}</g></svg></body></html>`);
  const effective = (id: string) => page.locator(`#${id} .away-mark`).evaluate((e) => { let o = 1; for (let n: Element | null = e; n && n.tagName !== "BODY"; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; });
  expect(await effective("nest"), "control: inside the group it is faded").toBeCloseTo(0.35, 5);
  expect(await effective("sib"), "beside the group it is not").toBe(1);
});
