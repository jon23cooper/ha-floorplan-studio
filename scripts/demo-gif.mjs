// node scripts/demo-gif.mjs
//
// Records a short screencast of the demo home — the card in 2D, 2.5D and 3D, then the editor — and converts it to
// README.md's demo GIF (docs/img/demo.gif). The home is demo/home.json with the evening states of demo/home-states.json
// (scripts/demo-home.mjs). Only demo/ is ever drawn, same rule as scripts/shots.mjs and scripts/doc-shots.mjs — no
// personal layout in a committed image. Needs ffmpeg on PATH, dist/ (npm run build) and dist-test/ (the 3D chunk the
// card fetches: FP_TEST_BUILD=1 node scripts/build.mjs). Run again, and commit the result, whenever the card or editor's
// look changes enough that the GIF would mislead.
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { home as layout, homeHass } from "./demo-home.mjs";

const EDITOR = "dist/editor.html";
const CARD_DIR = "dist-test"; // the card and its 3D chunk side by side, served as Home Assistant serves them
for (const f of [EDITOR, `${CARD_DIR}/floorplan-studio-card.js`]) {
  if (!existsSync(f)) { console.error(`Missing ${f}. Run \`npm run build\` and \`FP_TEST_BUILD=1 node scripts/build.mjs\` first.`); process.exit(1); }
}
try { execFileSync("ffmpeg", ["-version"]); } catch { console.error("ffmpeg not found on PATH."); process.exit(1); }

const OUT_DIR = "docs/img";
const VIDEO_DIR = "docs/img/.demo-gif-tmp";
mkdirSync(OUT_DIR, { recursive: true });
rmSync(VIDEO_DIR, { recursive: true, force: true });
mkdirSync(VIDEO_DIR, { recursive: true });

const evening = homeHass(); // lights on in the living areas, the kitchen motion sensor on, a window open, the sun low
const set = (h, patch) => { const c = structuredClone(h); for (const [id, state] of Object.entries(patch)) c.states[id] = { ...(c.states[id] ?? { attributes: {} }), state, last_changed: new Date().toISOString() }; return c; };
// A lamp can sit behind a switch (the Living light is powered by switch.demo_living_relay), and the plan shows it lit while the relay is on.
const LIGHTS = Object.keys(evening.states).filter((id) => /^(light|switch)\./.test(id) && evening.states[id].state === "on");
const quiet = set(evening, { ...Object.fromEntries(LIGHTS.map((id) => [id, "off"])), "binary_sensor.demo_kitchen_motion": "off", "binary_sensor.demo_dining_window": "off", "sun.sun": "above_horizon" });
const night = set(evening, { "sun.sun": "below_horizon" });

const SIZE = { width: 960, height: 640 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: SIZE, colorScheme: "light", reducedMotion: "reduce", recordVideo: { dir: VIDEO_DIR, size: SIZE } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== "http://fp.test") return route.abort();
  if (url.pathname === "/harness.html") return route.fulfill({ body: readFileSync("tests/card/harness-static.html"), contentType: "text/html" });
  const m = /^\/floorplan_studio_static\/([\w.-]+)$/.exec(url.pathname), file = m && resolve(CARD_DIR, m[1]);
  if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
  return route.fulfill({ body: readFileSync(file), contentType: "text/javascript" });
});

const card = (sel = "") => page.locator(`floorplan-studio-card ${sel}`.trim());
const setConfig = (config) => page.evaluate((c) => { const el = document.getElementById("card"); el.setConfig(c); return el.updateComplete; }, config);
const setHass = (h) => page.evaluate((h) => { const el = document.getElementById("card"); el.hass = h; return el.updateComplete; }, h);
const base = { layout, theme: "blueprint", active_list: false };

// Scene 1: the card on the ground floor by day, a quiet house, with the floor switcher over the plan.
await page.goto("http://fp.test/harness.html");
await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
await page.evaluate(() => { const w = document.getElementById("wrap"); w.style.width = "960px"; w.style.height = "640px"; document.body.style.margin = "0"; });
await page.evaluate(([c, h]) => { const el = document.getElementById("card"); el.setConfig(c); el.hass = h; return el.updateComplete; }, [{ ...base, floors: ["ground", "first", "basement"], view: "2d" }, quiet]);
await page.waitForTimeout(1500);

// Scene 2: evening. The lights come on, the kitchen sensor fires, the dining window is open.
await setHass(evening);
await page.waitForTimeout(2000);

// Scene 3: the floor switcher goes up to the first floor, then down to the basement, then back.
for (const name of ["First", "Basement", "Ground"]) {
  // the tab reads "Ground · 2" while two alerts are open, so match the start of the name
  await card(".fp-floors").getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(1300);
}

// Scene 4: Ctrl+wheel zooms in about the living room, then the fit button brings the whole floor back.
const svg = await card("svg").first().boundingBox();
await page.mouse.move(svg.x + svg.width * 0.3, svg.y + svg.height * 0.35);
await page.keyboard.down("Control");
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(120); }
await page.keyboard.up("Control");
await page.waitForTimeout(1100);
await card('button[aria-label="Fit"]').click();
await page.waitForTimeout(700);

// Scene 5: 2.5D, then 3D. The camera glides in on its own; one drag turns the house.
await setConfig({ ...base, floors: ["ground", "first", "basement"], view: "2.5d" });
await page.waitForTimeout(1800);
await setConfig({ ...base, floors: ["ground", "first", "basement"], view: "3d" });
await card("canvas").waitFor();
await page.waitForTimeout(2200);
{
  const b = await card("canvas").boundingBox();
  const x = b.x + b.width * 0.5, y = b.y + b.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(x + i * 9, y - i * 2); await page.waitForTimeout(60); }
  await page.mouse.up();
}
await page.waitForTimeout(1200);

// Scene 6: the sun sets; night darkens the rooms and the lit ones stay clear.
await setHass(night);
await page.waitForTimeout(2200);

// Scene 7: the editor. Load the demo home, open Add, select a device and drag it across the room.
await page.unroute("**/*");
await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), "blueprint");
await page.goto(pathToFileURL(resolve(EDITOR)).href);
await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
if (await page.locator("#fixPlan").isChecked()) await page.locator("label.lockplan").click(); // a locked plan refuses Reset
page.once("dialog", (d) => d.accept());
await page.locator('details.menu > summary:text-is("File")').click();
await page.locator("#reset").click();
await page.waitForTimeout(500);
await page.locator('details.menu > summary:text-is("File")').click();
await page.locator("#loaddemo").click();
await page.locator('.chip[data-f="ground"]').click();
await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
await page.waitForTimeout(1200);
await page.locator("#bannerClose").click();
await page.locator('details.menu > summary:text-is("Add")').click();
await page.waitForTimeout(1200);
await page.mouse.click(500, 700); // close the menu, same as a user clicking away
await page.waitForTimeout(300);
const box = await page.locator('g[data-x="0"]').first().boundingBox(); // the Living light (demo/home.json, ground floor)
if (!box) errors.push("editor: no box for g[data-x=\"0\"], the Living light");
else {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.locator("#panel").waitFor();
  await page.waitForTimeout(900);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx + i * 8, cy + i * 5); await page.waitForTimeout(60); }
  await page.mouse.up();
}
await page.waitForTimeout(1500);

await ctx.close();
await browser.close();

if (errors.length) { console.error("Problems during recording:\n" + errors.join("\n")); process.exit(1); }

const videoFile = readdirSync(VIDEO_DIR).find((f) => f.endsWith(".webm"));
if (!videoFile) { console.error("No video was recorded."); process.exit(1); }
const webm = resolve(VIDEO_DIR, videoFile);
const gif = resolve(OUT_DIR, "demo.gif");
const palette = resolve(VIDEO_DIR, "palette.png");

// 6 fps at 560 px with a 128 colour palette fits the 3 MB budget for this length; the blueprint theme's gradients (lamp glow,
// room light) are what cost bytes, so a smaller palette and a coarser dither help more than a lower frame rate.
const FPS = Number(process.env.GIF_FPS ?? 6), WIDTH = Number(process.env.GIF_WIDTH ?? 560), COLORS = Number(process.env.GIF_COLORS ?? 128), SKIP = "0.6"; // the first frames are the blank page before the card has drawn
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", SKIP, "-i", webm, "-vf", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=full:max_colors=${COLORS}`, "-update", "1", palette]);
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", SKIP, "-i", webm, "-i", palette, "-lavfi", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, gif]);

if (!process.env.KEEP_VIDEO) rmSync(VIDEO_DIR, { recursive: true, force: true });

const bytes = statSync(gif).size;
console.log(`${gif}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > 3 * 1024 * 1024) { console.error("Over the 3 MB budget (S5.4 done-when). Lower GIF_FPS, GIF_WIDTH, or shorten a scene."); process.exit(1); }
