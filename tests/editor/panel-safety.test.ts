import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioPanel } from "../../src/editor/panel";
import type { FloorplanStudioEditor } from "../../src/editor/editor-app";
import { STORAGE_KEY } from "../../src/editor/state";

// The panel's safety net: a theme flip, a second tab, a closed tab, a phone. Each test drives the panel through a stub
// `hass`, the object Home Assistant hands a panel.
//
// Shapes at the websocket boundary are copied from custom_components/floorplan_studio/websocket.py:
//   load  -> { layout, rev }          save -> { ok: true, rev }, or the error { code: "conflict", message } when expected_rev is stale.
const L = demo as unknown as Layout;
const withTitle = (title: string): Layout => ({ ...L, floors: { ...L.floors, ground: { ...L.floors.ground, title } } });

type Msg = { type: string; layout?: Layout; expected_rev?: number };
function stubHass(ws: (msg: Msg) => unknown, darkMode = false) {
  return { callWS: vi.fn(async (msg: Msg) => ws(msg)), themes: { darkMode }, states: {} };
}
const settle = async (el: FloorplanStudioPanel) => { for (let i = 0; i < 4; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };
async function mount(hass: ReturnType<typeof stubHass>, props: Partial<{ narrow: boolean }> = {}) {
  const el = new FloorplanStudioPanel();
  Object.assign(el, props);
  document.body.appendChild(el);
  el.hass = hass as never;
  await settle(el);
  return el;
}
const editorOf = (el: FloorplanStudioPanel) => el.shadowRoot!.querySelector("floorplan-studio-editor") as FloorplanStudioEditor;
type St = { views: Record<string, unknown>; floor: string; edit(fn: (f: { title?: string }) => void): boolean; layout: Layout; hist: unknown[]; planLocked: boolean };
const stOf = (el: FloorplanStudioPanel) => (editorOf(el) as unknown as { st: St }).st;
const editTitle = (el: FloorplanStudioPanel, title: string) => {
  const st = stOf(el);
  st.planLocked = false;
  expect(st.edit((f) => { f.title = title; })).toBe(true);
};
const saves = (hass: ReturnType<typeof stubHass>) => hass.callWS.mock.calls.map(([m]) => m).filter((m) => m.type === "floorplan_studio/save");
const q = (el: FloorplanStudioPanel, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const click = (el: FloorplanStudioPanel, sel: string) => { const b = q(el, sel); expect(b, sel).not.toBeNull(); b!.click(); };
const savingTo = (rev: () => number, extra: (m: Msg) => unknown = () => undefined) => (m: Msg) => {
  if (m.type === "floorplan_studio/load") return { layout: L, rev: rev() };
  if (m.type === "floorplan_studio/save") return extra(m) ?? { ok: true, rev: rev() + 1 };
  return undefined;
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.querySelectorAll("floorplan-studio-panel").forEach((n) => n.remove());
});

describe("G1: a theme flip does not throw away the Studio's edits", () => {
  it("keeps the edit, the undo step and the zoom when HA's dark mode flips, and hands the editor the new mode", async () => {
    const hass = stubHass(() => ({ layout: L, rev: 0 }));
    const el = await mount(hass);
    editTitle(el, "Edited by hand");
    stOf(el).views[stOf(el).floor] = { x: 1, y: 2, w: 300, h: 200 };
    const undo = stOf(el).hist.length;
    el.hass = { ...hass, themes: { darkMode: true } } as never;
    await settle(el);
    expect(editorOf(el).haDark).toBe(true);
    expect(editorOf(el).layout.floors[stOf(el).floor].title).toBe("Edited by hand");
    expect(stOf(el).hist.length).toBe(undo);
    expect(stOf(el).views[stOf(el).floor]).toEqual({ x: 1, y: 2, w: 300, h: 200 });
  });

  it("after a Save the panel holds what was saved, so a later flip cannot bring the old plan back", async () => {
    const hass = stubHass(savingTo(() => 0));
    const el = await mount(hass);
    editTitle(el, "Saved title");
    editorOf(el).save();
    await settle(el);
    expect(saves(hass)).toHaveLength(1);
    expect(el.layout!.floors.ground.title).toBe("Saved title");
    const undo = stOf(el).hist.length;
    el.hass = { ...hass, themes: { darkMode: true } } as never;
    await settle(el);
    expect(editorOf(el).layout.floors.ground.title).toBe("Saved title");
    expect(stOf(el).hist.length).toBe(undo);
  });
});

describe("G2: unsaved work is flagged and guarded", () => {
  it("is clean after load, dirty after an edit, clean again after the undo, clean after a successful save", async () => {
    const hass = stubHass(savingTo(() => 0));
    const el = await mount(hass);
    const ed = editorOf(el);
    expect(ed.dirty).toBe(false);
    editTitle(el, "Changed");
    expect(ed.dirty).toBe(true);
    expect((ed as unknown as { st: { undo(): boolean } }).st.undo()).toBe(true);
    expect(ed.dirty).toBe(false);
    editTitle(el, "Changed again");
    ed.save();
    await settle(el);
    expect(ed.dirty).toBe(false);
  });

  it("an edit made while the save is in flight stays dirty", async () => {
    let release!: () => void;
    const hass = stubHass((m) => (m.type === "floorplan_studio/save" ? new Promise((r) => { release = () => r({ ok: true, rev: 1 }); }) : { layout: L, rev: 0 }));
    const el = await mount(hass);
    editTitle(el, "First");
    editorOf(el).save();
    await settle(el);
    editTitle(el, "Second");
    release();
    await settle(el);
    expect(editorOf(el).dirty).toBe(true);
  });

  it("a failed save leaves it dirty", async () => {
    const hass = stubHass((m) => { if (m.type === "floorplan_studio/save") throw { code: "unknown", message: "boom" }; return { layout: L, rev: 0 }; });
    const el = await mount(hass);
    editTitle(el, "Unsaved");
    editorOf(el).save();
    await settle(el);
    expect(editorOf(el).dirty).toBe(true);
  });

  it("asks the browser to confirm leaving while dirty, and stays quiet when clean", async () => {
    const el = await mount(stubHass(() => ({ layout: L, rev: 0 })));
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    editTitle(el, "Unsaved");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    el.remove();
    const gone = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(gone);
    expect(gone.defaultPrevented).toBe(false); // the listener leaves with the panel
  });
});

describe("G13: the draft banner", () => {
  const draft = () => withTitle("Draft title");
  const AT = "2026-10-21T14:03:00.000Z";
  const plant = (layout: unknown, at: string | null = AT) => {
    localStorage.setItem(STORAGE_KEY, typeof layout === "string" ? layout : JSON.stringify(layout));
    if (at) localStorage.setItem(`${STORAGE_KEY}:at`, at);
  };
  const stored = () => hass0();
  const hass0 = () => stubHass(() => ({ layout: L, rev: 0 }));

  it("offers a draft that differs from the stored plan, with its time, and Restore brings it back as one undo step", async () => {
    plant(draft());
    const el = await mount(stored());
    const box = q(el, ".draft");
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain("Restore unsaved draft from");
    expect(box!.textContent).toMatch(/2026-10-21 \d\d:03/); // local time, 24 h, minutes as written
    expect(stOf(el).hist.length).toBe(0);
    click(el, ".draft .restore");
    await settle(el);
    expect(editorOf(el).layout.floors.ground.title).toBe("Draft title");
    expect(stOf(el).hist.length).toBe(1);
    expect(editorOf(el).dirty).toBe(true);
    expect(q(el, ".draft")).toBeNull();
    expect((editorOf(el) as unknown as { st: { undo(): boolean } }).st.undo()).toBe(true);
    expect(editorOf(el).layout.floors.ground.title).toBe(L.floors.ground.title);
  });

  it("Discard hides the banner, forgets the draft and leaves the stored plan alone", async () => {
    plant(draft());
    const el = await mount(stored());
    click(el, ".draft .discard");
    await settle(el);
    expect(q(el, ".draft")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEY}:at`)).toBeNull();
    expect(editorOf(el).layout.floors.ground.title).toBe(L.floors.ground.title);
    expect(editorOf(el).dirty).toBe(false);
  });

  it("says nothing when the draft is the stored plan, when there is no draft, or when the draft has no time", async () => {
    plant(L);
    expect(q(await mount(stored()), ".draft")).toBeNull();
    localStorage.clear();
    expect(q(await mount(stored()), ".draft")).toBeNull();
    localStorage.clear();
    plant(draft(), null);
    const el = await mount(stored());
    expect(q(el, ".draft")!.textContent).toContain("an earlier session");
  });

  it.each([
    ["not json", "{not json"],
    ["null", "null"],
    ["an array", "[]"],
    ["floors as a number", '{"version":2,"floors":5}'],
    ["a __proto__ floor", '{"version":2,"floors":{"__proto__":{}}}'],
    ["a number", "42"],
  ])("a junk draft (%s) never throws and shows no banner", async (_n, raw) => {
    plant(raw);
    const el = await mount(stored());
    expect(q(el, ".draft")).toBeNull();
    expect(editorOf(el).layout.floors.ground.title).toBe(L.floors.ground.title);
  });

  it("Restore goes through validate: a draft that fails leaves the plan and the undo stack as they were", async () => {
    plant(draft());
    const el = await mount(stored());
    (el as unknown as { draft: unknown }).draft = { version: 2, floors: {} }; // went bad between the banner and the click
    click(el, ".draft .restore");
    await settle(el);
    expect(editorOf(el).layout.floors.ground.title).toBe(L.floors.ground.title);
    expect(stOf(el).hist.length).toBe(0);
    expect(editorOf(el).errors.length).toBeGreaterThan(0);
    expect(editorOf(el).dirty).toBe(false);
  });

  it("with nothing stored yet, a draft is still offered", async () => {
    plant(draft());
    const el = await mount(stubHass(() => ({ layout: null, rev: 0 })));
    expect(q(el, ".draft")).not.toBeNull();
  });
});

describe("G6: the panel saves against the revision it loaded", () => {
  it("sends expected_rev with every save and moves to the revision the server answers with", async () => {
    let rev = 3;
    const hass = stubHass(savingTo(() => rev, () => { rev += 1; return { ok: true, rev }; }));
    const el = await mount(hass);
    editTitle(el, "One");
    editorOf(el).save();
    await settle(el);
    editTitle(el, "Two");
    editorOf(el).save();
    await settle(el);
    expect(saves(hass).map((m) => m.expected_rev)).toEqual([3, 4]);
  });

  it("sends no expected_rev to an integration that does not report one", async () => {
    const hass = stubHass((m) => (m.type === "floorplan_studio/load" ? { layout: L } : { ok: true }));
    const el = await mount(hass);
    editTitle(el, "One");
    editorOf(el).save();
    await settle(el);
    expect(saves(hass)).toHaveLength(1);
    expect("expected_rev" in saves(hass)[0]).toBe(false);
  });

  describe("on a conflict", () => {
    const conflicted = (state: { rev: number; stored: Layout }) => stubHass((m) => {
      if (m.type === "floorplan_studio/load") return { layout: state.stored, rev: state.rev };
      if (m.type === "floorplan_studio/save") {
        if (m.expected_rev !== state.rev) throw { code: "conflict", message: "The plan was saved elsewhere (revision 9, you have 3)." };
        state.stored = m.layout!; state.rev += 1;
        return { ok: true, rev: state.rev };
      }
      return undefined;
    });
    async function conflictedPanel() {
      const state = { rev: 3, stored: L };
      const hass = conflicted(state);
      const el = await mount(hass);
      state.stored = withTitle("Elsewhere"); state.rev = 9; // the other tab saved
      editTitle(el, "Mine");
      editorOf(el).save();
      await settle(el);
      return { el, hass, state };
    }

    it("says so with Reload and Overwrite, keeps the edit, and writes nothing", async () => {
      const { el, state } = await conflictedPanel();
      const box = q(el, ".conflict");
      expect(box).not.toBeNull();
      expect(box!.textContent).toMatch(/changed elsewhere/i);
      expect(q(el, ".conflict .reload")).not.toBeNull();
      expect(q(el, ".conflict .overwrite")).not.toBeNull();
      expect(state.stored.floors.ground.title).toBe("Elsewhere");
      expect(editorOf(el).layout.floors.ground.title).toBe("Mine");
      expect(editorOf(el).dirty).toBe(true);
    });

    it("Reload takes the other version through validate as one undo step, and the next save uses its revision", async () => {
      const { el, hass, state } = await conflictedPanel();
      const undo = stOf(el).hist.length;
      click(el, ".conflict .reload");
      await settle(el);
      expect(editorOf(el).layout.floors.ground.title).toBe("Elsewhere");
      expect(stOf(el).hist.length).toBe(undo + 1);
      expect(q(el, ".conflict")).toBeNull();
      expect(editorOf(el).dirty).toBe(false);
      editTitle(el, "After reload");
      editorOf(el).save();
      await settle(el);
      expect(saves(hass).at(-1)!.expected_rev).toBe(9);
      expect(state.stored.floors.ground.title).toBe("After reload");
    });

    it("Reload of an unusable plan changes nothing and says so", async () => {
      const { el, state } = await conflictedPanel();
      state.stored = { version: 2, floors: 5 } as never;
      click(el, ".conflict .reload");
      await settle(el);
      expect(editorOf(el).layout.floors.ground.title).toBe("Mine");
      expect(editorOf(el).errors.length).toBeGreaterThan(0);
    });

    it("Overwrite saves my plan against the latest revision", async () => {
      const { el, hass, state } = await conflictedPanel();
      click(el, ".conflict .overwrite");
      await settle(el);
      expect(saves(hass).at(-1)!.expected_rev).toBe(9);
      expect(state.stored.floors.ground.title).toBe("Mine");
      expect(state.rev).toBe(10);
      expect(q(el, ".conflict")).toBeNull();
      expect(editorOf(el).dirty).toBe(false);
    });
  });
});

describe("G8: the way back to HA's menu on a narrow screen", () => {
  it("shows no bar on a wide screen", async () => {
    const el = await mount(stubHass(() => ({ layout: L, rev: 0 })), { narrow: false });
    expect(q(el, ".bar")).toBeNull();
  });

  it("falls back to a button that fires hass-toggle-menu when ha-menu-button is not defined", async () => {
    expect(customElements.get("ha-menu-button")).toBeUndefined();
    const el = await mount(stubHass(() => ({ layout: L, rev: 0 })), { narrow: true });
    const heard = vi.fn();
    el.addEventListener("hass-toggle-menu", heard);
    click(el, ".bar button.menu");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("uses <ha-menu-button> with hass and narrow when HA has defined it", async () => {
    customElements.define("ha-menu-button", class extends HTMLElement {});
    const hass = stubHass(() => ({ layout: L, rev: 0 }));
    const el = await mount(hass, { narrow: true });
    const btn = q(el, ".bar ha-menu-button") as HTMLElement & { hass?: unknown; narrow?: boolean };
    expect(btn).not.toBeNull();
    expect(btn.narrow).toBe(true);
    expect(btn.hass).toBe(el.hass);
    expect(q(el, ".bar button.menu")).toBeNull();
  });
});
