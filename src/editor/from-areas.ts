import { placeableDevicesInArea, type HaData } from "../core";
import type { EdgeKind, Layout, Pt, Room } from "../core/schema";
import { EditorState, emptyLayout } from "./state";

/** S37.2: the side of the room drawn for each area, in cm. Four metres: a lamp, a switch and a sensor fit, and the corners are there to be dragged. */
export const AREA_ROOM_CM = 400;

/**
 * S37.2: a first plan from Home Assistant's areas. One AREA_ROOM_CM square per area that has something the plan can draw,
 * on a grid that wraps (as square as it can be, areas by name), a wall on every edge, linked to the area by its id the way
 * a drawn room is. Each room gets the entities Place would give it (`placeableDevicesInArea`, so one icon per HA device,
 * noise such as a power reading left out, an entity in its own area before its device's): the same code runs, on a scratch
 * state, so the two cannot disagree. The outline is the box round the rooms.
 *
 * Returns null when no area has a drawable entity (0 areas included): there is nothing to draw, and a layout with no
 * rooms is not a valid one. The caller still runs the result through `validate`; this never throws.
 */
export function layoutFromAreas(ha: HaData | undefined): Layout | null {
  if (!ha || !Array.isArray(ha.areas) || !Array.isArray(ha.entities)) return null;
  const seen = new Set<string>();
  const areas: { id: string; name: string }[] = [];
  for (const a of ha.areas) {
    if (!a || typeof a.id !== "string" || !a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    areas.push({ id: a.id, name: typeof a.name === "string" && a.name ? a.name : a.id });
  }
  areas.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const blank = emptyLayout();
  const drawn = areas.filter((a) => placeableDevicesInArea(blank, ha, a.id).length > 0);
  if (!drawn.length) return null;

  const cols = Math.ceil(Math.sqrt(drawn.length)), rows = Math.ceil(drawn.length / cols), S = AREA_ROOM_CM;
  const wall: EdgeKind[] = ["wall", "wall", "wall", "wall"];
  const layout = emptyLayout();
  const floor = layout.floors.ground;
  floor.outline = [[0, 0], [cols * S, 0], [cols * S, rows * S], [0, rows * S]];
  floor.owk = ["external", "external", "external", "external"];
  floor.rooms = drawn.map((a, i): Room => {
    const x = (i % cols) * S, y = Math.floor(i / cols) * S;
    const pts: Pt[] = [[x, y], [x + S, y], [x + S, y + S], [x, y + S]];
    return { id: `room-ground-${i + 1}`, name: a.name, area: a.id, kind: "room", pts, wk: [...wall] };
  });

  // Place's own spreading, on a scratch state that knows HA, one room at a time.
  const st = new EditorState(layout, "ground");
  st.ha = ha;
  drawn.forEach((_, i) => st.placeArea(i));
  return st.layout;
}
