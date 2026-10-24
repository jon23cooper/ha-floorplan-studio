// Shared by the doc media scripts (doc-shots, theme-shots, demo-gif): the demo home and its evening states.
// Only demo/ is ever drawn, same rule as scripts/shots.mjs, so no personal layout reaches a committed image.
// demo/layout.json stays the test fixture; the pictures come from demo/home.json and demo/home-states.json.
import { readFileSync } from "node:fs";

export const home = JSON.parse(readFileSync("demo/home.json", "utf8"));

/**
 * The states file is a snapshot from one evening. Its `last_changed` times are moved forward together so the newest one is
 * a minute old: motion fades from `last_changed`, and an old snapshot would show every sensor already grey.
 */
export function homeStates(now = Date.now()) {
  const raw = JSON.parse(readFileSync("demo/home-states.json", "utf8"));
  const newest = Math.max(...Object.values(raw).map((s) => Date.parse(s.last_changed)));
  const shift = now - 60_000 - newest;
  const states = {};
  for (const [id, s] of Object.entries(raw)) states[id] = { ...s, last_changed: new Date(Date.parse(s.last_changed) + shift).toISOString() };
  return states;
}

/** A hass object for the card. No callService: a function cannot cross into the page, and nothing here clicks. */
export const homeHass = (darkMode = false, now = Date.now()) => ({ states: homeStates(now), themes: { darkMode } });
