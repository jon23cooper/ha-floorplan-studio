import { describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { camPickOf, camThumbOf } from "../../src/core/camera-thumb";
import { parseStoredView } from "../../src/card/view-state";
import { parseViewMemory } from "../../src/editor/view-memory";
import { EditorState } from "../../src/editor/state";

// S16.3: the viewer's camera thumbnail pick, in the card's stored view and the Studio's view memory. Storage is untrusted.

const isView = (v: unknown) => v === "2d" || v === "2.5d";

describe("camera thumbnail pick: storage is untrusted", () => {
  it("camPickOf keeps well formed fields on their own and is null when none is", () => {
    expect(camPickOf({ on: true, size: "large", pos: "left" })).toEqual({ on: true, size: "large", pos: "left" });
    expect(camPickOf({ on: "yes", size: "large", pos: "diagonal" })).toEqual({ size: "large" });
    for (const junk of [null, undefined, 5, "on", [], {}, { on: 1, size: 9 }]) expect(camPickOf(junk)).toBeNull();
  });

  it("the card's stored view carries it, and drops junk", () => {
    expect(parseStoredView({ cam: { on: true, pos: "above" } }, isView, ["light"]).cam).toEqual({ on: true, pos: "above" });
    expect(parseStoredView({ cam: "on" }, isView, ["light"]).cam).toBeUndefined();
  });

  it("the Studio's view memory carries it, and drops junk", () => {
    expect(parseViewMemory({ v: 1, cam: { on: true, size: "small" } }).cam).toEqual({ on: true, size: "small" });
    expect(parseViewMemory({ v: 1, cam: [1] }).cam).toBeUndefined();
  });

  it("a viewer pick wins over the YAML, field by field", () => {
    const yaml = { camera_thumb: "on", camera_thumb_size: "small", camera_thumb_pos: "above" };
    expect(camThumbOf(yaml)).toEqual({ on: true, size: "small", pos: "above" });
    expect(camThumbOf(yaml, { on: false, pos: "right" })).toEqual({ on: false, size: "small", pos: "right" });
  });

  it("the Studio exports a non-default pick and imports it back; the default leaves the memory bare", () => {
    const st = new EditorState(structuredClone(demo) as unknown as Layout);
    expect(st.exportView().cam).toBeUndefined();
    st.cam = { on: true, size: "large", pos: "right" };
    const out = st.exportView();
    expect(out.cam).toEqual({ on: true, size: "large", pos: "right" });
    const other = new EditorState(structuredClone(demo) as unknown as Layout);
    other.importView(out);
    expect(other.cam).toEqual({ on: true, size: "large", pos: "right" });
  });
});
