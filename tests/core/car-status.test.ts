import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, type Device, type Furniture } from "../../src/core/schema";
import { carMain, carStatus, carText } from "../../src/core/car-status";
import { classOf, renderFloor } from "../../src/core/render";
import { pieceDevice } from "../../src/core/solids";
import { stateText } from "../../src/core/state-text";
import { ACTIVE_LIST_RULE } from "../../src/core/active";
import { NO_TOGGLE } from "../../src/card/actions";

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-17T10:00:00Z" });
const car = (entity: string | undefined, attached?: string[]) => ({ entity, attached });

// Shapes copied from the integrations' value lists in docs/specs/car-s35.md ("What Home Assistant offers"):
// Renault core: binary_sensor device_class battery_charging, on/off; sensor charge state `charge_in_progress`.
// Tesla Fleet / Teslemetry: sensor enum charge_state_charging_state: starting, charging, stopped, complete, disconnected, no_power.
// Volvo core: sensor enum charging_status: charging, discharging, done, error, idle, scheduled.
const RENAULT_CHARGING_ON = { "binary_sensor.zoe_charging": st("on", { device_class: "battery_charging" }) };
const TESLA_CHARGING = { "sensor.t3_charging": st("charging", { device_class: "enum" }) };
const VOLVO_CHARGING = { "sensor.xc40_charging_status": st("charging", { device_class: "enum" }) };
const RENAULT_IN_PROGRESS = { "sensor.zoe_charge_state": st("charge_in_progress") };

describe("S35.3 carStatus: place", () => {
  it.each([["home", "home", undefined], ["not_home", "away", undefined], ["Work", "away", "Work"]])("tracker state %s is %s", (state, place, zone) => {
    const s = carStatus(car("device_tracker.c"), { "device_tracker.c": st(state) });
    expect(s.place).toBe(place);
    expect(s.zone).toBe(zone);
  });
  it.each(["unavailable", "unknown", ""])("tracker state %j is unknown", (state) => {
    expect(carStatus(car("device_tracker.c"), { "device_tracker.c": st(state) }).place).toBe("unknown");
  });
  it("no tracker among the entities: place none, and the text says nothing of home", () => {
    const s = carStatus(car("sensor.c_battery"), { "sensor.c_battery": st("50", { device_class: "battery", unit_of_measurement: "%" }) });
    expect(s.place).toBe("none");
    expect(carText(s)).toBe("50 %");
  });
  it("the tracker may be an attached entity, the first one wins", () => {
    const states = { "device_tracker.a": st("not_home"), "device_tracker.b": st("home") };
    expect(carStatus(car("lock.c", ["device_tracker.a", "device_tracker.b"]), states).place).toBe("away");
  });
  it("tracker with no state in the overlay is unknown", () => {
    expect(carStatus(car("device_tracker.c"), {}).place).toBe("unknown");
  });
});

describe("S35.3 carStatus: charging", () => {
  it.each([["Renault binary_sensor", RENAULT_CHARGING_ON], ["Tesla enum", TESLA_CHARGING], ["Volvo enum", VOLVO_CHARGING], ["Renault charge_in_progress", RENAULT_IN_PROGRESS]])("%s charges", (_n, states) => {
    expect(carStatus(car("device_tracker.c", Object.keys(states)), states as never).charging).toBe(true);
  });
  it.each([["stopped"], ["complete"], ["disconnected"], ["no_power"], ["idle"], ["unavailable"]])("a sensor state %s is not charging", (state) => {
    expect(carStatus(car("device_tracker.c", ["sensor.x"]), { "sensor.x": st(state) }).charging).toBe(false);
  });
  it("case is ignored", () => {
    expect(carStatus(car("sensor.x"), { "sensor.x": st("Charging") }).charging).toBe(true);
  });
  it("a binary_sensor that is on but not battery_charging does not charge; one that is off does not", () => {
    expect(carStatus(car("binary_sensor.d"), { "binary_sensor.d": st("on", { device_class: "door" }) }).charging).toBe(false);
    expect(carStatus(car("binary_sensor.d"), { "binary_sensor.d": st("off", { device_class: "battery_charging" }) }).charging).toBe(false);
  });
});

describe("S35.3 carStatus: level", () => {
  const bat = st("78", { device_class: "battery", unit_of_measurement: "%" });
  it("a battery sensor in %", () => {
    expect(carStatus(car("device_tracker.c", ["sensor.b"]), { "sensor.b": bat }).level).toBe(78);
    expect(carText(carStatus(car("device_tracker.c", ["sensor.b"]), { "sensor.b": bat, "device_tracker.c": st("home") }))).toBe("Home · 78 %");
  });
  it("battery wins over fuel, whatever the order", () => {
    const states = { "sensor.fuel_level": st("40", { unit_of_measurement: "%" }), "sensor.b": bat };
    expect(carStatus(car("device_tracker.c", ["sensor.fuel_level", "sensor.b"]), states).level).toBe(78);
  });
  it("fuel: a % sensor whose id holds fuel", () => {
    expect(carStatus(car("sensor.c_fuel_level"), { "sensor.c_fuel_level": st("40", { unit_of_measurement: "%" }) }).level).toBe(40);
  });
  it("a % sensor with no fuel in its id and no battery class is not a level", () => {
    expect(carStatus(car("sensor.c_humidity"), { "sensor.c_humidity": st("40", { unit_of_measurement: "%" }) }).level).toBeNull();
  });
  it("a battery sensor in km is not a level; a non number is not; out of range is not", () => {
    expect(carStatus(car("sensor.b"), { "sensor.b": st("300", { device_class: "battery", unit_of_measurement: "km" }) }).level).toBeNull();
    expect(carStatus(car("sensor.b"), { "sensor.b": st("unavailable", { device_class: "battery", unit_of_measurement: "%" }) }).level).toBeNull();
    expect(carStatus(car("sensor.b"), { "sensor.b": st("140", { device_class: "battery", unit_of_measurement: "%" }) }).level).toBeNull();
  });
  it("rounds to a whole percent", () => {
    expect(carStatus(car("sensor.b"), { "sensor.b": st("77.6", { device_class: "battery", unit_of_measurement: "%" }) }).level).toBe(78);
  });
});

describe("S35.3 carStatus: alert", () => {
  it.each([["lock.doors", "unlocked", undefined], ["lock.doors", "open", undefined], ["binary_sensor.door", "on", "door"], ["binary_sensor.w", "on", "window"], ["binary_sensor.o", "on", "opening"], ["binary_sensor.g", "on", "garage_door"]])("%s %s is an alert", (e, state, dc) => {
    expect(carStatus(car("device_tracker.c", [e]), { [e]: st(state, dc ? { device_class: dc } : {}) }).alert).toBe(true);
  });
  it.each([["lock.doors", "locked", undefined], ["binary_sensor.door", "off", "door"], ["binary_sensor.m", "on", "motion"], ["binary_sensor.p", "on", "problem"]])("%s %s is not", (e, state, dc) => {
    expect(carStatus(car("device_tracker.c", [e]), { [e]: st(state, dc ? { device_class: dc } : {}) }).alert).toBe(false);
  });
});

describe("S35.3 carText", () => {
  const states = { "device_tracker.c": st("Work"), ...RENAULT_CHARGING_ON, "sensor.b": st("78", { device_class: "battery", unit_of_measurement: "%" }) };
  it("Home, Away, Away · zone", () => {
    expect(carText(carStatus(car("device_tracker.c"), { "device_tracker.c": st("home") }))).toBe("Home");
    expect(carText(carStatus(car("device_tracker.c"), { "device_tracker.c": st("not_home") }))).toBe("Away");
    expect(carText(carStatus(car("device_tracker.c"), { "device_tracker.c": st("Work") }))).toBe("Away · Work");
  });
  it("then Charging, then the level", () => {
    expect(carText(carStatus(car("device_tracker.c", ["binary_sensor.zoe_charging", "sensor.b"]), states as never))).toBe("Away · Work · Charging · 78 %");
  });
  it("an unknown place and nothing else reads Unknown", () => {
    expect(carText(carStatus(car("device_tracker.c"), { "device_tracker.c": st("unavailable") }))).toBe("Unknown");
  });
  it("a zone name is text, not markup: returned verbatim for the caller to escape", () => {
    expect(carText(carStatus(car("device_tracker.c"), { "device_tracker.c": st('"><script>') }))).toBe('Away · "><script>');
  });
});

describe("S35.3 carStatus never throws on junk (finding 1)", () => {
  const boom = { get state(): string { throw new Error("x"); }, get attributes(): never { throw new Error("y"); } };
  const junk: unknown[] = [null, undefined, 5, "x", [], { "device_tracker.c": null }, { "device_tracker.c": 5 }, { "device_tracker.c": { state: 5, attributes: null } }, { "device_tracker.c": boom, "sensor.b": boom, "lock.l": boom }, { "device_tracker.c": { state: "home", attributes: 7 } }];
  it.each(junk.map((j, i) => [i, j]))("states #%i", (_i, states) => {
    expect(() => carText(carStatus(car("device_tracker.c", ["sensor.b", "lock.l"]), states as never))).not.toThrow();
  });
  it.each([null, undefined, 5, "x", {}, { entity: 5 }, { entity: "device_tracker.c", attached: "x" }, { entity: "", attached: [5, null, {}] }, { attached: ["__proto__", "constructor"] }])("car shape %j", (m) => {
    expect(() => carText(carStatus(m as never, { "device_tracker.c": st("home") }))).not.toThrow();
    expect(() => carMain(m as never)).not.toThrow();
  });
  it("__proto__ and constructor are not states", () => {
    expect(carStatus(car("device_tracker.c", ["__proto__"]), {} as never).place).toBe("unknown");
  });
});

describe("S35.3 carMain", () => {
  it("the entity, else the first attached entity id", () => {
    expect(carMain(car("device_tracker.c", ["sensor.b"]))).toBe("device_tracker.c");
    expect(carMain(car(undefined, ["sensor.b"]))).toBe("sensor.b");
    expect(carMain(car("", [5 as never, "sensor.b"]))).toBe("sensor.b");
    expect(carMain(car(undefined))).toBeNull();
  });
});

describe("S35.3 pieceDevice reports a car piece", () => {
  const piece = (extra: Partial<Furniture> & Record<string, unknown>): Furniture => ({ id: "c", symbol: "car", x: 10, y: 20, rot: 0, w: 470, h: 182, ...extra }) as Furniture;
  it("with a main entity: type car, entity, attached", () => {
    expect(pieceDevice(piece({ entity: "device_tracker.c", attached: ["sensor.b"], name: "Zoe" }))).toMatchObject({ type: "car", entity: "device_tracker.c", attached: ["sensor.b"], name: "Zoe", x: 10, y: 20 });
  });
  it("with no entity the first attached one is main", () => {
    expect(pieceDevice(piece({ attached: ["sensor.b", "lock.l"] }))).toMatchObject({ entity: "sensor.b", attached: ["sensor.b", "lock.l"] });
  });
  it("with neither: null", () => {
    expect(pieceDevice(piece({}))).toBeNull();
    expect(pieceDevice(piece({ attached: [] }))).toBeNull();
  });
  it("junk attached never throws", () => {
    expect(pieceDevice(piece({ attached: "x" }))).toBeNull();
    expect(pieceDevice(piece({ entity: "device_tracker.c", attached: [5, null] }))?.entity).toBe("device_tracker.c");
  });
  it("a sofa with an entity is still not linked", () => {
    expect(pieceDevice(piece({ symbol: "sofa", entity: "light.x" }))).toBeNull();
  });
});

describe("S35.3 classOf and the plan's class for a car", () => {
  const dev = (extra: Record<string, unknown> = {}): Device => ({ id: "c", type: "car", entity: "device_tracker.c", x: 0, y: 0, ...extra }) as Device;
  const o = (state: Record<string, ReturnType<typeof st>>) => ({ state }) as never;
  it("on while charging, off while parked, unavailable when the main entity is dead", () => {
    expect(classOf(dev({ attached: ["binary_sensor.zoe_charging"] }), o({ "device_tracker.c": st("home"), ...RENAULT_CHARGING_ON }))).toBe("on");
    expect(classOf(dev({ attached: ["binary_sensor.zoe_charging"] }), o({ "device_tracker.c": st("home"), "binary_sensor.zoe_charging": st("off", { device_class: "battery_charging" }) }))).toBe("off");
    expect(classOf(dev(), o({ "device_tracker.c": st("unavailable") }))).toBe("unavailable");
  });
  it("a car whose tracker is home is NOT on just because the state is 'home' or 'on'", () => {
    expect(classOf(dev(), o({ "device_tracker.c": st("home") }))).toBe("off");
    expect(classOf(dev({ entity: "switch.charger" }), o({ "switch.charger": st("on") }))).toBe("off");
  });
  const svg = (entity: string, state: string, charging = false) => {
    const f = { title: "F", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [dev({ entity })], furniture: [], unlinked: [] };
    const states: Record<string, ReturnType<typeof st>> = { [entity]: st(state) };
    void charging;
    return renderFloor(f as never, { state: states } as never);
  };
  it("a car icon on a tracker wears away and the away mark like a person; at home it wears home", () => {
    const away = svg("device_tracker.c", "not_home");
    expect(away).toMatch(/class="dev [^"]*\bcar\b[^"]*\baway\b/);
    expect(away).toContain("away-mark");
    expect(svg("device_tracker.c", "home")).toMatch(/class="dev [^"]*\bcar\b[^"]*\bhome\b/);
  });
  it("a car icon on a non-tracker entity does not fade", () => {
    expect(svg("switch.charger", "off")).not.toMatch(/\baway\b/);
  });
  it("a car icon whose tracker is unavailable wears neither", () => {
    expect(svg("device_tracker.c", "unavailable")).not.toMatch(/class="dev [^"]*\b(away|home)\b/);
  });
});

describe("S35.3 stateText of car is the car text", () => {
  it("reads the reading as the main entity when it is given", () => {
    expect(stateText("car", st("not_home"), undefined, "device_tracker.c")).toBe("Away");
    expect(stateText("car", st("Work"), undefined, "device_tracker.c")).toBe("Away · Work");
  });
  it("other types are unchanged", () => {
    expect(stateText("light", st("on", { brightness: 255 }))).toBe("100 %");
  });
});

describe("S35.3 the per-type tables name car as C5 says (findings 17, 20)", () => {
  it("DEVICE_TYPES includes car, and the car column holds", () => {
    expect(DEVICE_TYPES).toContain("car");
    expect(NO_TOGGLE.has("car")).toBe(true);
    expect(ACTIVE_LIST_RULE.car).toBe("on");
  });
  it("only car changed in NO_TOGGLE's last decision: every other type keeps its rule", () => {
    expect(ACTIVE_LIST_RULE.person).toBe("on");
    expect(ACTIVE_LIST_RULE.ups).toBe("never");
  });
});
