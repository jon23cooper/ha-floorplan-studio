import { describe, expect, it } from "vitest";
import { DEVICE_TYPES } from "../../src/core/schema";
import { stateText } from "../../src/core";
import { meanReading } from "../../src/core/readings";

// S14.2 item 17: ONE formatter for the plan's room readout, the popup and the tooltip. The plan prints a reading as the
// state Home Assistant sends plus its unit (render.ts, `s.state + unit`); this pins that rule everywhere.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes });

describe("stateText: one text for the plan, the popup and the tooltip", () => {
  it("prints a sensor reading as the state and its unit, as the plan does", () => {
    expect(stateText("temp", st("21.7", { unit_of_measurement: "°C" }))).toBe("21.7 °C");
    expect(stateText("humidity", st("48", { unit_of_measurement: "%" }))).toBe("48 %");
    expect(stateText("battery", st("83", { unit_of_measurement: "%" }))).toBe("83 %");
    expect(stateText("temp", st("21.7"))).toBe("21.7"); // no unit: none invented
  });
  it("a room's mean reading drops the trailing .0, so 48 % reads 48 % everywhere (it printed 48.0 % before)", () => {
    const s = { "sensor.h": st("48", { unit_of_measurement: "%" }), "sensor.h2": st("48", { unit_of_measurement: "%" }) };
    expect(meanReading(["sensor.h", "sensor.h2"], s as never)).toBe("48\u202F%");
    const t = { "sensor.a": st("21", { unit_of_measurement: "°C" }), "sensor.b": st("22.4", { unit_of_measurement: "°C" }) };
    expect(meanReading(["sensor.a", "sensor.b"], t as never)).toBe("21.7\u202F°C");
  });
  it("a light says its brightness in percent, asymmetric values so a swap fails", () => {
    expect(stateText("light", st("on", { brightness: 128 }))).toBe("50 %");
    expect(stateText("light", st("on", { brightness: 255 }))).toBe("100 %");
    expect(stateText("light", st("on", { brightness: 64 }))).toBe("25 %");
    expect(stateText("light", st("on", {}))).toBe("on");
    expect(stateText("light", st("off", { brightness: 128 }))).toBe("off");
  });
  it("a cover says its position, a plug its power", () => {
    expect(stateText("cover", st("open", { current_position: 40 }))).toBe("open · 40 %");
    expect(stateText("cover", st("closed"))).toBe("closed");
    expect(stateText("plug", st("on"), "42 W")).toBe("on · 42 W");
    expect(stateText("plug", st("off"))).toBe("off");
  });
  it("is untrusted-input safe: no state, junk attributes, junk numbers", () => {
    expect(stateText("light", undefined)).toBe("no state");
    expect(stateText("light", st("on", { brightness: "bright" }))).toBe("on");
    expect(stateText("cover", st("open", { current_position: NaN }))).toBe("open");
    expect(stateText("temp", st("unavailable", { unit_of_measurement: "°C" }))).toBe("unavailable");
    expect(stateText("temp", { state: 5 as unknown as string, attributes: null })).toBe("no state");
    expect(stateText("light", st("on", { brightness: 999 }))).toBe("100 %"); // clamped
  });
  it("decides every device type (finding 17): none throws, none is empty", () => {
    for (const t of DEVICE_TYPES) expect(stateText(t, st("on", { unit_of_measurement: "W" })), t).not.toBe("");
  });
  it("G9: a formatter passed in writes the text, for sensors and for enum states; light and cover keep their own lines", () => {
    const fmt = (e: string) => ({ "sensor.t": "21.5 °C (f)", "climate.c": "Heat/Cool (f)", "person.p": "Away (f)", "light.l": "On (f)", "cover.c": "Open (f)" })[e];
    expect(stateText("temp", st("21.456789", { unit_of_measurement: "°C" }), undefined, "sensor.t", fmt)).toBe("21.5 °C (f)");
    expect(stateText("climate", st("heat_cool"), undefined, "climate.c", fmt)).toBe("Heat/Cool (f)");
    expect(stateText("person", st("not_home"), "3 W", "person.p", fmt)).toBe("Away (f) · 3 W");
    expect(stateText("light", st("on", { brightness: 128 }), undefined, "light.l", fmt)).toBe("50 %");
    expect(stateText("cover", st("open", { current_position: 30 }), undefined, "cover.c", fmt)).toBe("open · 30 %");
    expect(stateText("temp", st("21.456789", { unit_of_measurement: "°C" }), undefined, "sensor.t")).toBe("21.456789 °C"); // no formatter: raw
    expect(stateText("temp", st("1"), undefined, "sensor.other", fmt)).toBe("1"); // formatter says nothing: raw
  });
});
