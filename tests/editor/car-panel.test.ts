import { describe, it, expect } from "vitest";
import { CAR_MODELS, MAX_CAR_ATTACHED, validate, type Layout } from "../../src/core/schema";
import { CAR_SPEC } from "../../src/core";
import { EditorState } from "../../src/editor/state";

// S35.7, spec C9: the Studio's car writers. Each is one undo step, none when nothing changes (finding 6), and each
// leaves a layout `validate` accepts, after the step and after Undo and Redo (finding 12).
const car = (extra: Record<string, unknown> = {}) => ({ id: "furniture-ground-1", symbol: "car", x: 300, y: 300, rot: 30, w: 470, h: 182, ...extra });
const make = (over: { furniture?: unknown[]; devices?: unknown[]; unlinked?: unknown[]; palette?: string[] } = {}) => {
  const l = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], ...(over.palette ? { palette: over.palette } : {}),
    floors: { ground: { title: "Ground", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: over.devices ?? [], furniture: over.furniture ?? [car()], unlinked: over.unlinked ?? [] } } } as unknown as Layout;
  return new EditorState(l);
};
const ok = (st: EditorState, what: string) => { const r = validate(st.layout); expect(r.ok, `${what}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true); };
/** Runs `go`, then checks it is exactly one step: valid now, valid after Undo, valid after Redo, state back after Redo. */
function oneStep(st: EditorState, what: string, go: () => boolean) {
  const before = JSON.stringify(st.layout);
  expect(go(), what).toBe(true);
  const after = JSON.stringify(st.layout);
  expect(after, what).not.toBe(before);
  ok(st, `${what} (done)`);
  expect(st.undo(), what).toBe(true);
  expect(JSON.stringify(st.layout), `${what} undone in one step`).toBe(before);
  ok(st, `${what} (undone)`);
  expect(st.redo(), what).toBe(true);
  expect(JSON.stringify(st.layout), `${what} redone`).toBe(after);
  ok(st, `${what} (redone)`);
}
const none = (st: EditorState, what: string, go: () => boolean) => {
  const before = JSON.stringify(st.layout);
  expect(go(), what).toBe(false);
  expect(JSON.stringify(st.layout), what).toBe(before);
  expect(st.undo(), `${what}: no step recorded`).toBe(false);
};

describe("setCarModel", () => {
  it("every model, from every typed size and height: footprint set, height deleted, one step", () => {
    for (const from of [undefined, "wagon", "citycar"] as const) for (const typed of [{}, { w: 123, h: 77, height: 400 }]) for (const model of CAR_MODELS) {
      const st = make({ furniture: [car({ ...(from ? { model: from } : {}), ...typed })] });
      const was = st.f.furniture[0].model ?? "sedan";
      if (model === was && !("height" in typed) && st.f.furniture[0].w === CAR_SPEC[model].w) { none(st, `${from}->${model}`, () => st.setCarModel(0, model)); continue; }
      oneStep(st, `${from}/${JSON.stringify(typed)} -> ${model}`, () => st.setCarModel(0, model));
      // A sedan is the absent model (C2), so the key is not stored for it.
      expect(st.f.furniture[0].model).toBe(model === "sedan" ? undefined : model);
      expect(st.f.furniture[0]).toMatchObject({ w: CAR_SPEC[model].w, h: CAR_SPEC[model].h });
      expect(st.f.furniture[0]).not.toHaveProperty("height");
      expect(st.f.furniture[0]).toMatchObject({ x: 300, y: 300, rot: 30 });
    }
  });
  it("picking the model it already is records nothing", () => {
    const st = make({ furniture: [car({ model: "suv", w: CAR_SPEC.suv.w, h: CAR_SPEC.suv.h })] });
    none(st, "suv again", () => st.setCarModel(0, "suv"));
  });
  it("a car with no model is a sedan: picking sedan at its sedan size is no step, a typed size is replaced", () => {
    const plain = make();
    none(plain, "sedan again", () => plain.setCarModel(0, "sedan"));
    const st = make({ furniture: [car({ w: 300 })] });
    oneStep(st, "sedan resets the size", () => st.setCarModel(0, "sedan"));
  });
  it("refuses junk and a piece that is not a car; nothing recorded", () => {
    const st = make({ furniture: [car(), { ...car(), id: "f2", symbol: "sofa" }] });
    for (const bad of ["Sedan", "__proto__", "constructor", "", 5, null, undefined]) none(st, String(bad), () => st.setCarModel(0, bad as never));
    none(st, "sofa", () => st.setCarModel(1, "suv"));
    none(st, "no such piece", () => st.setCarModel(9, "suv"));
  });
});

describe("paintCar", () => {
  it("a built-in swatch colour is stored lower-cased and does not touch the palette", () => {
    const st = make();
    oneStep(st, "built-in", () => st.paintCar(0, "#AA0000"));
    expect(st.f.furniture[0].color).toBe("#aa0000");
  });
  it("a custom colour joins layout.palette in the same step, once; undo takes both back", () => {
    const st = make();
    oneStep(st, "custom", () => st.paintCar(0, "#12AB34"));
    expect(st.layout.palette).toEqual(["#12ab34"]);
    expect(st.f.furniture[0].color).toBe("#12ab34");
    st.paintCar(0, "#654321");
    st.paintCar(0, "#12ab34"); // already in the palette: not added twice
    expect(st.layout.palette).toEqual(["#12ab34", "#654321"]);
  });
  it("null is Theme colour: the key goes, one step; none when there is none", () => {
    const st = make({ furniture: [car({ color: "#112233" })] });
    oneStep(st, "theme colour", () => st.paintCar(0, null));
    expect(st.f.furniture[0]).not.toHaveProperty("color");
    const st2 = make();
    none(st2, "theme colour again", () => st2.paintCar(0, null));
  });
  it("the same colour again is no step; junk is refused", () => {
    const st = make({ furniture: [car({ color: "#112233" })], palette: ["#112233"] });
    none(st, "same", () => st.paintCar(0, "#112233"));
    for (const bad of ["red", "#12345", "#1234567", "112233", "#gggggg", "", "url(x)"]) none(st, bad, () => st.paintCar(0, bad));
  });
});

describe("attached suggestions: the order is a decision (C9)", () => {
  const ha = (st: EditorState) => {
    st.ha = { floors: [], areas: [], devices: [{ id: "d1", name: "Model 3" }], entities: [
      { id: "sensor.zeta_other", name: "Zeta", domain: "sensor" },
      { id: "switch.garage", name: "Garage", domain: "switch" },
      { id: "sensor.m3_diag", name: "Model 3 signal", domain: "sensor", dev: "d1", cat: "diagnostic" },
      { id: "sensor.m3_battery", name: "Model 3 battery", domain: "sensor", dev: "d1" },
      { id: "device_tracker.m3", name: "Model 3 location", domain: "device_tracker", dev: "d1" },
      { id: "binary_sensor.tesla_door", name: "Tesla door", domain: "binary_sensor" },
      { id: "lock.tesla", name: "Tesla lock", domain: "lock" },
      { id: "input_boolean.tesla_flag", name: "Tesla flag", domain: "input_boolean" },
      { id: "sensor.aaa_diag", name: "Aaa diag", domain: "sensor", cat: "diagnostic" },
      { id: "input_number.target", name: "Target", domain: "input_number" },
    ] };
  };
  it("the main entity's device first, then the car's name, then car domains, then the rest, diagnostics last", () => {
    const st = make({ furniture: [car({ name: "Tesla", entity: "device_tracker.m3" })] });
    ha(st);
    const groups = st.carAttachChoices(0).map((g) => `${g.group}|${g.entry.entity}`);
    expect(groups).toEqual([
      "This car's device|sensor.m3_battery",
      "Named like this car|binary_sensor.tesla_door",
      "Named like this car|input_boolean.tesla_flag",
      "Named like this car|lock.tesla",
      "Car entities|sensor.zeta_other",
      "Car entities|switch.garage",
      "Other|input_number.target",
      "Diagnostic|sensor.aaa_diag",
      "Diagnostic|sensor.m3_diag",
    ]);
  });
});

describe("addAllFromCar", () => {
  const withDevice = (n: number, st: EditorState) => {
    st.ha = { floors: [], areas: [], devices: [{ id: "d1", name: "Car" }], entities: [
      { id: "device_tracker.c", name: "Car location", domain: "device_tracker", dev: "d1" },
      ...Array.from({ length: n }, (_, i) => ({ id: `sensor.c_${String(i).padStart(2, "0")}`, name: `Car ${String(i).padStart(2, "0")}`, domain: "sensor", dev: "d1" })),
      { id: "sensor.elsewhere", name: "Elsewhere", domain: "sensor", dev: "d2" },
    ] };
  };
  it("adds the main entity's device entities not yet attached, one undo step; the main one is not attached to itself", () => {
    const st = make({ furniture: [car({ entity: "device_tracker.c", attached: ["sensor.c_01"] })] });
    withDevice(3, st);
    expect(st.carDeviceEntities(0)).toEqual(["sensor.c_00", "sensor.c_02"]);
    oneStep(st, "add all", () => st.attachEntity(st.carDeviceEntities(0), (f) => { f.furniture[0].attached = [...(f.furniture[0].attached ?? []), ...st.carDeviceEntities(0)]; }).changed);
    expect(st.f.furniture[0].attached).toEqual(["sensor.c_01", "sensor.c_00", "sensor.c_02"]);
    expect(st.carDeviceEntities(0)).toEqual([]); // nothing left: the button is hidden
  });
  it("stops at 24 whatever the device holds, and the layout validates", () => {
    for (const [have, device] of [[0, 30], [20, 30], [24, 30], [0, 24], [23, 1]] as const) {
      const pre = Array.from({ length: have }, (_, i) => `sensor.pre_${i}`);
      const st = make({ furniture: [car({ entity: "device_tracker.c", ...(have ? { attached: pre } : {}) })] });
      withDevice(device, st);
      const add = st.carDeviceEntities(0);
      expect(add.length, `${have}+${device}`).toBe(Math.min(device, MAX_CAR_ATTACHED - have));
      if (add.length) oneStep(st, `${have}+${device}`, () => st.attachEntity(add, (f) => { f.furniture[0].attached = [...(f.furniture[0].attached ?? []), ...add]; }).changed);
      expect(st.f.furniture[0].attached?.length ?? 0).toBeLessThanOrEqual(MAX_CAR_ATTACHED);
    }
  });
  it("nothing to add without Home Assistant, without a main entity, or when the main has no device", () => {
    const st = make({ furniture: [car({ entity: "device_tracker.c" })] });
    expect(st.carDeviceEntities(0)).toEqual([]);
    withDevice(2, st);
    st.f.furniture[0].entity = "device_tracker.none";
    expect(st.carDeviceEntities(0)).toEqual([]);
    delete st.f.furniture[0].entity;
    expect(st.carDeviceEntities(0)).toEqual([]);
  });
  it("with no main entity the first attached one is the main (C2)", () => {
    const st = make({ furniture: [car({ attached: ["device_tracker.c"] })] });
    withDevice(2, st);
    expect(st.carDeviceEntities(0)).toEqual(["sensor.c_00", "sensor.c_01"]);
  });
});

describe("convertToCar", () => {
  it("a device car becomes a sedan piece at the same point; its entity is the main one; one step", () => {
    const st = make({ furniture: [], devices: [{ id: "d-car", name: "Golf", type: "car", entity: "device_tracker.golf", x: 120, y: 80 }] });
    let picked: unknown;
    oneStep(st, "device", () => { const r = st.convertToCar("dev", 0); picked ??= st.sel; return r; });
    expect(picked).toEqual({ t: "furn", i: 0 }); // selected when done (Undo clears the selection)
    expect(st.f.devices).toHaveLength(0);
    expect(st.f.furniture).toHaveLength(1);
    expect(st.f.furniture[0]).toMatchObject({ symbol: "car", x: 120, y: 80, rot: 0, w: CAR_SPEC.sedan.w, h: CAR_SPEC.sedan.h, name: "Golf", entity: "device_tracker.golf" });
    expect(st.f.furniture[0]).not.toHaveProperty("model");
  });
  it("an unlinked car keeps point, turn, name, colour and attached", () => {
    const st = make({ furniture: [], unlinked: [{ id: "u1", type: "car", name: "Pickup", x: 10, y: 20, rot: 135, scale: 1, color: "#aa5500", attached: ["sensor.a", "sensor.b"] }] });
    oneStep(st, "unlinked", () => st.convertToCar("unl", 0));
    expect(st.f.unlinked).toHaveLength(0);
    expect(st.f.furniture[0]).toMatchObject({ symbol: "car", x: 10, y: 20, rot: 135, name: "Pickup", color: "#aa5500", attached: ["sensor.a", "sensor.b"] });
    expect(st.f.furniture[0]).not.toHaveProperty("entity");
  });
  it("every combination of the optional inputs validates, after Undo and Redo too", () => {
    for (const name of [undefined, "Car"]) for (const color of [undefined, "#aa5500", "red", "not a colour"]) for (const attached of [undefined, [], ["sensor.a"], Array.from({ length: 30 }, (_, i) => `sensor.x${i}`), ["sensor.a", "sensor.a"]]) for (const rot of [0, 90, 359]) {
      const un = { id: "u1", type: "car", x: 10, y: 20, rot, scale: 1, ...(name ? { name } : {}), ...(color ? { color } : {}), ...(attached ? { attached } : {}) };
      const st = make({ furniture: [], unlinked: [un] });
      const before = JSON.stringify(st.layout);
      expect(st.convertToCar("unl", 0)).toBe(true);
      ok(st, `unl ${JSON.stringify(un)}`);
      st.undo(); expect(JSON.stringify(st.layout)).toBe(before);
      st.redo(); ok(st, "redo");
    }
    for (const entity of [undefined, "device_tracker.g", "nodot"]) for (const name of [undefined, "Golf", ""]) {
      const d = { id: "d1", type: "car", x: 1, y: 2, ...(entity ? { entity } : {}), ...(name !== undefined ? { name } : {}) };
      const st = make({ furniture: [], devices: [d] });
      expect(st.convertToCar("dev", 0), JSON.stringify(d)).toBe(true);
      ok(st, `dev ${JSON.stringify(d)}`);
    }
  });
  it("refuses anything that is not a car, or does not exist; nothing recorded", () => {
    const st = make({ furniture: [], devices: [{ id: "d1", type: "light", entity: "light.a", name: "A", x: 1, y: 1 }], unlinked: [{ id: "u1", type: "tv", x: 1, y: 1, rot: 0, scale: 1 }] });
    none(st, "light", () => st.convertToCar("dev", 0));
    none(st, "tv", () => st.convertToCar("unl", 0));
    none(st, "missing", () => st.convertToCar("dev", 5));
  });
  it("a new id never clashes with a piece already there", () => {
    const st = make({ furniture: [car({ id: "furniture-ground-1" })], unlinked: [{ id: "u1", type: "car", x: 1, y: 1, rot: 0, scale: 1 }] });
    st.convertToCar("unl", 0);
    expect(new Set(st.f.furniture.map((m) => m.id)).size).toBe(2);
    ok(st, "ids");
  });
});

describe("carAttachGroups on untrusted catalog and Home Assistant names (review finding 13)", () => {
  it("an entry or an entity with no name, a null name or a number for a name never throws, and is still offered", async () => {
    const { carAttachGroups } = await import("../../src/editor/car-ops");
    const m = car({ name: "Family", entity: "device_tracker.car" }) as never;
    const catalog = [{ id: "c1", floor: "", room: "", type: "temp", entity: "sensor.family_a" }, { id: "c2", floor: "", room: "", type: "temp", name: null, entity: "sensor.b" }, { id: "c3", floor: "", room: "", type: "temp", name: 5, entity: "sensor.c" }] as never;
    const ha = { entities: [{ id: "sensor.d", domain: "sensor" }, { id: "sensor.e", name: null, domain: "sensor" }] } as never;
    let out: { entry: { id: string } }[] = [];
    expect(() => { out = carAttachGroups(m, ha, catalog); }).not.toThrow();
    expect(out.map((g) => g.entry.id).sort()).toEqual(["sensor.b", "sensor.c", "sensor.d", "sensor.e", "sensor.family_a"]);
  });
});
