import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioPanel } from "../../src/editor/panel";
import type { FloorplanStudioEditor } from "../../src/editor/editor-app";
import { STORAGE_KEY } from "../../src/editor/state";

// Opus review of task/finish-sprints: three defects in the panel's load and save path.
//
// Shapes at the websocket boundary are copied from custom_components/floorplan_studio/websocket.py:
//   load  -> { layout, rev }; every floor.trace is stripped unless the message has with_trace: true AND the user is admin.
//   save  -> { ok: true, rev }, or the error { code: "conflict", message } when expected_rev is stale.
const TRACE = { src: "data:image/png;base64,iVBORw0KGgo=", x: 10, y: 20, w: 900, rot: 0, alpha: 0.5, on: true };
const base = demo as unknown as Layout;
const withTrace = (l: Layout): Layout => ({ ...l, floors: { ...l.floors, ground: { ...l.floors.ground, trace: TRACE } } });
const withoutTrace = (l: Layout): Layout => { const c = structuredClone(l); for (const f of Object.values(c.floors)) delete f.trace; return c; };
const withTitle = (l: Layout, title: string): Layout => ({ ...l, floors: { ...l.floors, ground: { ...l.floors.ground, title } } });
const TRACED = withTrace(base);

type Msg = { type: string; layout?: Layout; expected_rev?: number; with_trace?: boolean };
function stubHass(ws: (msg: Msg) => unknown) {
  return { callWS: vi.fn(async (msg: Msg) => ws(msg)), themes: { darkMode: false }, states: {} };
}
type Hass = ReturnType<typeof stubHass>;
const settle = async (el: FloorplanStudioPanel) => { for (let i = 0; i < 4; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };
async function mount(hass: Hass) {
  const el = new FloorplanStudioPanel();
  document.body.appendChild(el);
  el.hass = hass as never;
  await settle(el);
  return el;
}
const editorOf = (el: FloorplanStudioPanel) => el.shadowRoot!.querySelector("floorplan-studio-editor") as FloorplanStudioEditor;
type St = { edit(fn: (f: { title?: string }) => void): boolean; planLocked: boolean };
const stOf = (el: FloorplanStudioPanel) => (editorOf(el) as unknown as { st: St }).st;
const editTitle = (el: FloorplanStudioPanel, title: string) => {
  const st = stOf(el);
  st.planLocked = false;
  expect(st.edit((f) => { f.title = title; })).toBe(true);
};
const saves = (hass: Hass) => hass.callWS.mock.calls.map(([m]) => m).filter((m) => m.type === "floorplan_studio/save");
const q = (el: FloorplanStudioPanel, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.querySelectorAll("floorplan-studio-panel").forEach((n) => n.remove());
});

describe("R1: a load that strips the trace never feeds a path that can save", () => {
  // A server that keeps the trace on disk and strips it unless the message asks for it.
  const server = (state: { stored: Layout; rev: number }) => stubHass((m) => {
    if (m.type === "floorplan_studio/load") return { layout: m.with_trace === true ? state.stored : withoutTrace(state.stored), rev: state.rev };
    if (m.type === "floorplan_studio/save") {
      if (m.expected_rev !== state.rev) throw { code: "conflict", message: "The plan was saved elsewhere." };
      state.stored = m.layout!; state.rev += 1;
      return { ok: true, rev: state.rev };
    }
    return undefined;
  });

  it("Conflict, Reload keeps the trace images, and the next Save writes them back", async () => {
    const state = { stored: TRACED, rev: 3 };
    const hass = server(state);
    const el = await mount(hass);
    expect(editorOf(el).layout.floors.ground.trace).toEqual(TRACE);
    state.stored = withTitle(TRACED, "Elsewhere"); state.rev = 9; // the other tab saved
    editTitle(el, "Mine");
    editorOf(el).save();
    await settle(el);
    q(el, ".conflict .reload")!.click();
    await settle(el);
    expect(editorOf(el).layout.floors.ground.title).toBe("Elsewhere");
    expect(editorOf(el).layout.floors.ground.trace).toEqual(TRACE);
    editTitle(el, "After reload");
    editorOf(el).save();
    await settle(el);
    expect(saves(hass).at(-1)!.layout!.floors.ground.trace).toEqual(TRACE);
    expect(state.stored.floors.ground.trace).toEqual(TRACE);
  });

  it("every floorplan_studio/load the editor code sends asks with_trace: true", () => {
    const dir = "src/editor";
    let found = 0;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(`${dir}/${name}`, "utf8");
      for (const m of text.matchAll(/\{[^{}]*type:\s*"floorplan_studio\/load"[^{}]*\}/g)) {
        found++;
        expect(m[0], `${name}: ${m[0]}`).toMatch(/with_trace:\s*true/);
      }
    }
    expect(found).toBeGreaterThanOrEqual(3); // load, reloadStored, overwriteStored: a refactor that hides the calls must not pass by finding none
  });
});

describe("R2: the autosave draft", () => {
  const AT = "2026-10-21T14:03:00.000Z";
  const plant = (layout: unknown) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    localStorage.setItem(`${STORAGE_KEY}:at`, AT);
  };

  it("a successful save clears the draft, so another device's later edit is not met by an old draft", async () => {
    const state = { stored: base, rev: 0 };
    const hass = stubHass((m) => {
      if (m.type === "floorplan_studio/load") return { layout: state.stored, rev: state.rev };
      state.stored = m.layout!; state.rev += 1; return { ok: true, rev: state.rev };
    });
    const first = await mount(hass);
    editTitle(first, "Saved here");
    editorOf(first).save();
    await settle(first);
    expect(state.stored.floors.ground.title).toBe("Saved here");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEY}:at`)).toBeNull();
    first.remove();
    state.stored = withTitle(base, "Edited on the phone"); state.rev += 1; // another device
    const second = await mount(hass);
    expect(q(second, ".draft")).toBeNull();
  });

  it("a failed save keeps the draft", async () => {
    const hass = stubHass((m) => { if (m.type === "floorplan_studio/save") throw { code: "unknown", message: "boom" }; return { layout: base, rev: 0 }; });
    const el = await mount(hass);
    editTitle(el, "Unsaved");
    editorOf(el).save();
    await settle(el);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("a draft that is the stored plan without its traces (the autosave dropped them) is not offered", async () => {
    plant(withoutTrace(TRACED));
    const el = await mount(stubHass(() => ({ layout: TRACED, rev: 0 })));
    expect(q(el, ".draft")).toBeNull();
  });

  it("a trace-less draft with real edits is offered, and Restore keeps the stored traces", async () => {
    plant(withTitle(withoutTrace(TRACED), "Draft title"));
    const el = await mount(stubHass(() => ({ layout: TRACED, rev: 0 })));
    expect(q(el, ".draft")).not.toBeNull();
    q(el, ".draft .restore")!.click();
    await settle(el);
    expect(editorOf(el).layout.floors.ground.title).toBe("Draft title");
    expect(editorOf(el).layout.floors.ground.trace).toEqual(TRACE);
  });

  it("a draft that has its own trace keeps it", async () => {
    const mine = { ...TRACE, x: 77 };
    plant(withTitle({ ...TRACED, floors: { ...TRACED.floors, ground: { ...TRACED.floors.ground, trace: mine } } }, "Draft title"));
    const el = await mount(stubHass(() => ({ layout: TRACED, rev: 0 })));
    q(el, ".draft .restore")!.click();
    await settle(el);
    expect(editorOf(el).layout.floors.ground.trace).toEqual(mine);
  });
});

describe("R3: a second Save before the first reply is not a conflict with the first", () => {
  it("is queued: no conflict, and the newest state is what ends up stored", async () => {
    const state = { stored: base, rev: 5 };
    const release: Array<() => void> = [];
    const hass = stubHass((m) => {
      if (m.type !== "floorplan_studio/save") return { layout: state.stored, rev: state.rev }; // load, and HA's registry calls
      return new Promise((resolve, reject) => {
        release.push(() => {
          if (m.expected_rev !== state.rev) { reject({ code: "conflict", message: "The plan was saved elsewhere." }); return; }
          state.stored = structuredClone(m.layout!); state.rev += 1;
          resolve({ ok: true, rev: state.rev });
        });
      });
    });
    const el = await mount(hass);
    editTitle(el, "First");
    editorOf(el).save();
    editTitle(el, "Second");
    editorOf(el).save(); // before the first reply
    await settle(el);
    expect(saves(hass)).toHaveLength(1); // held, not sent with the same revision
    release[0]();
    await settle(el);
    expect(saves(hass).map((m) => m.expected_rev)).toEqual([5, 6]);
    release[1]();
    await settle(el);
    expect(q(el, ".conflict")).toBeNull();
    expect(state.stored.floors.ground.title).toBe("Second");
    expect(state.rev).toBe(7);
    expect(editorOf(el).dirty).toBe(false);
  });

  it("when the first save fails, the held one is dropped and the failure is shown", async () => {
    const hass = stubHass((m) => {
      if (m.type !== "floorplan_studio/save") return { layout: base, rev: 1 };
      return new Promise((_r, reject) => { setTimeout(() => reject({ code: "unknown", message: "boom" }), 5); });
    });
    const el = await mount(hass);
    editTitle(el, "First");
    editorOf(el).save();
    editTitle(el, "Second");
    editorOf(el).save();
    await new Promise((r) => setTimeout(r, 30));
    await settle(el);
    expect(saves(hass)).toHaveLength(1);
    expect(editorOf(el).dirty).toBe(true);
    expect(editorOf(el).status).toMatch(/Save failed/);
  });
});
