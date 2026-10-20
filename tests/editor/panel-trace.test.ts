import { describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import { FloorplanStudioPanel } from "../../src/editor/panel";

// G5: the card no longer receives trace images, so the Studio must ask for them or it would lose every trace.
describe("<floorplan-studio-panel> load request", () => {
  it("asks for the trace images", async () => {
    const callWS = vi.fn(async () => ({ layout: demo }));
    const el = new FloorplanStudioPanel();
    document.body.appendChild(el);
    el.hass = { callWS, callService: vi.fn(), themes: { darkMode: false }, states: {} } as never;
    for (let i = 0; i < 4; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); }
    const loads = (callWS.mock.calls as unknown as [{ type: string; with_trace?: boolean }][]).map(([m]) => m).filter((m) => m.type === "floorplan_studio/load");
    expect(loads).toEqual([{ type: "floorplan_studio/load", with_trace: true }]);
  });
});
