# Extras: Sprint 34, favourites and heat map

Status: Approved by Diego 2026-10-17 on the defaults; questions below use their defaults. Drafted 2026-10-17.
Plan: `docs/PLAN.md`, Sprint 34. Follows `docs/specs/extras-s33.md` (X5, X6, Q2, Q3).

## Why

Roadmap row 33 listed six extras. Sprint 33 (0.31.0) shipped four. Two were left because each had two readings:
favourites (Q2) and the heat map (Q3). Diego, 2026-10-17, took the defaults:

- **Favourites** are a YAML list on the card, `favourites`, of entity ids. Not per Home Assistant user.
- **Heat map** fills rooms by the current temperature or humidity. No history. The sensor comes from the room's
  existing temperature and humidity sensors. No new room key.

## What the code does today (0.31.0)

- **Room sensors.** A room may list its own `temps` and `humidity` sensors (S11.1, `Room` in `src/core/schema.ts`,
  at most `MAX_ROOM_SENSORS`). They draw no icon. The plan prints their mean under the room's name
  (`roomReadout`, `renderFloor`, `text.val[data-rv]`), from `meanReading` (`src/core/readings.ts`): the readable states
  in the unit of the first one read, others left out, "" when none. The card's room section prints the same
  (`roomSummary`). Sensors placed as `temp` or `humidity` devices print their own value beside their icon; they do not
  feed the room's readout. The demo uses placed devices only.
- **Which room.** `roomAt(f, p)` (`render.ts`) is the one rule: the smallest room whose kind may own a point
  (`ROOM_OWNS`: room, garden, pavement, terrace, water yes; fill, structure, zone no).
- **Room fills.** `renderFloor` draws one `<polygon class="room room-<kind>">` per room. Each kind sets
  `--fp-room-fill`. A painted room carries a `fill` attribute (own colour or texture). `room_glow` mixes `--fp-glow`
  25 % into `--fp-room-fill` (`.room.glow:not([fill])`). At night a `room-night` polygon veils every unlit room. A room
  with an `entity` gets an `.on` stroke. The motion perimeter and the picked room are inset lines. Every rule that
  matters has a computed-style pair (finding 10).
- **A heat ramp exists.** Plugs are tinted by draw (S14.8): `--fp-heat` 0..1 on the icon, three fixed tokens
  `--fp-heat-cool` (blue), `--fp-heat-mid` (amber), `--fp-heat-hot` (red), the same in every theme, mixed in oklch
  (`FLOORPLAN_CSS`; `heatColour` in `src/core/ink.ts` does the same in JS).
- **Detail.** Room readouts show at every level, far included (`[data-detail]` rules hide `text.val:not([data-rv])`
  only). `labels: false` drops every text, readouts too.
- **The Overview** (card only) lists Attention, then Active by category. Rows go to the thing and open its popup. The
  popup's primary button comes from `popupOp` / `lampOp` (`src/card/popup.ts`); OFF asks first for every type but a
  light (S14.2). No sheet under `kiosk` or `active_list: false`.
- **Search** is one index for Studio and card (`src/core/search.ts`). `searchIndex` sorts by tier, then name length,
  then entry order. A blank query shows nothing.
- **View memory.** `StoredView` (`src/card/view-state.ts`) holds a viewer's picks; `_viewStorageKey` hashes the config
  keys whose change starts a clean memory. The Studio keeps its own (`src/editor/view-memory.ts`). Every Studio View
  control has a row in `view-parity.spec.ts` and `docs/card.md`.
- **The Studio has live states** inside Home Assistant (`stateForRender`, `_hassStates`); standalone it has none.

## Decisions

### F. Favourites

**F1. The key.** `favourites: [entity ids]` on the card. `favorites` is read too, as an alias; `favourites` wins when
both are set. Card YAML is untrusted (finding 1):

- a list of strings, each an entity id (`domain.object_id`, lower case, digits and `_`), trimmed;
- repeats dropped, first kept; order kept; at most `MAX_FAVOURITES` = 24, the rest dropped;
- anything else (a string, a number, an object, `null`, a non-entity string, `__proto__`) is dropped;
- one `console.warn` per card when something was dropped, naming the key. Never a throw.

**F2. Where they show.** A **Favourites** section at the top of the Overview, above Attention. Overview level only:
picking a floor or a room shows that level's own content, as today. Scope is every floor the card shows, whatever
"All floors" says: a favourite is a shortcut, not a floor fact. Rows are badged with their floor when the card shows
more than one. The section folds like a category group, and its fold is kept with the others (`fp-active-panel:`).
No section when no favourite resolves.

**F3. A row.** The icon in its state colour (`colorVarFor`), the name (`nameFor`), the state line (the popup's text),
and the popup's primary button inline, from the same `_popupOp` and `_runOp`: Turn on acts; Turn off asks first for
every type but a light (the button turns into **Confirm turn off** and **Cancel**); Lock, Unlock, Open, Close as the
popup. A type with no button (sensor, camera, media player, `NO_TOGGLE`) has none. Unavailable: dimmed, no button.
A tap on the row (not the button) goes to the thing, as an Active row does. A row is a list row: `tap_action` does not
apply (S33.4 rule for rows).

**F4. What can be a favourite.** An entity drawn on a floor the card shows: a device's `entity`, or a linked
furniture piece's entity (`pieceDevice`). The first in layout order wins when two things share it. An entity not on
the plan, or only on a floor the card leaves out, is dropped from the section (no row with nowhere to go), with no
warning: it is valid YAML, it is just not here. A favourite hidden by Layers or Detail is still listed.

**F5. Also elsewhere.** A favourite also stays in Active or Attention where it belongs. Nothing else in the card
changes: no star on the plan, no badge on the icon.

**F6. Search.** A favourite ranks first within its tier (`searchIndex` gains an optional set of entities; the sort is
tier, then favourite, then name length, then order). The Studio passes none, so its search is byte for byte as before.

**F7. How it is set.** A card cannot write its own YAML, so there is **no star in the popup**. Two ways:

- YAML, as above.
- The Edit-card form: a **Favourites** field. An input with a `datalist` of the layout's entities (name and id), an
  Add button, and the list below with a remove button per row. Add appends; a repeat or a non-entity is refused with a
  line saying why. An empty list removes the key. Order is the YAML's; reorder in YAML. The form writes `favourites`
  and drops `favorites`.

**F8. Studio.** None, on purpose. The Overview is card chrome; the Studio has its Outline. The memory rule (parity) is
for view controls; favourites are not one. The DECISIONS line says so.

**F9. Not in kiosk.** Kiosk and `active_list: false` have no sheet, so no section. Documented.

### H. Heat map

**H1. What it is.** A mode of the plan: `off`, `temperature` or `humidity`. In a mode, every room that has a reading
of that kind is filled by it on a fixed ramp, and prints the value. A room with no reading keeps its own fill.
Drawn by `renderFloor` (finding 8): new option `heat?: HeatKind`. Omitted or `off`, the markup is byte for byte as
before.

**H2. Which sensors (Q2).** For room `i` and kind `temperature`:

1. the room's own `temps` list, when any of it is readable (the same mean the readout prints, so the colour and the
   number never disagree);
2. else the `temp` devices whose point `roomAt` puts in room `i` (the smallest owning room, the one rule; a device in
   no room feeds nothing; a device inside a zone feeds the room under it).

Humidity is the same with `humidity`. The mean is `meanReading`'s: the first readable unit, others left out. A sensor
listed by two rooms feeds both (it was listed twice on purpose). A `climate` device's `current_temperature` is not a
source (its state is a mode; a thermostat often reads at the radiator). Per type, `HEAT_SOURCE: Record<DeviceType,
HeatKind | null>`: `temp` is `temperature`, `humidity` is `humidity`, every other type `null`, each a decision
(finding 17). Kinds come from `ROOM_OWNS`: a fill, a structure or a zone never takes heat, a garden or water does.

**H3. The scale.** Fixed, absolute, so a colour means the same thing every day (Q1):

| Kind | Cold or dry end | Middle | Warm or wet end | Unit read | Not a reading |
|---|---|---|---|---|---|
| temperature | 16 °C, `--fp-heat-cool` | 21 °C, `--fp-heat-mid` | 26 °C, `--fp-heat-hot` | `°C`, `°F` (converted), none (taken as °C) | another unit; outside -60..90 °C |
| humidity | 30 %, `--fp-hum-dry` | 50 %, `--fp-hum-mid` | 70 %, `--fp-hum-wet` | `%`, none | another unit; outside 0..100 |

- Temperature reuses the plug's three tokens: one ramp in the product means "how hot". Humidity gets three new fixed
  tokens on the same line of `FLOORPLAN_CSS` (`:host,.fp,[data-theme]`): dry a sand, middle a pale green, wet a blue.
  Same in every theme, as the plug ramp. The values are picked in S34.7 and checked against every theme's room fill.
- `t` = position on the scale, clamped to 0..1. A value past an end takes the end colour; the printed number is the
  real one.
- Unavailable, unknown, a comma decimal, `NaN`, `Infinity`, an out-of-range value, another unit: not a reading. A
  room with none keeps its own fill and prints no heat value. Nothing throws, nothing prints `NaN`.
- The mean is taken in the sensor's unit (°F stays °F in the label), then converted to °C for `t`.

**H4. The fill.** The polygon gets class `heat` and `style="--fp-heat:<t>"` (a number, never text). The rule mixes the
ramp colour 55 % into `--fp-room-fill` (the kind's colour, not the paint), in oklch, so water stays recognisably
water. The heat fill wins over:

- `room_glow` (`.room.glow:not([fill])`): a lit room shows its heat, not its glow; the lamp's aura still shows the light;
- a painted room's own colour or texture (Q3): the heat map is a data view, and a class rule beats the `fill`
  attribute (finding 18), so the rule wins and a computed-style pair proves it;
- the night veil (Q3): in a heat mode `renderFloor` draws no `room-night` polygons, so the scale is not darkened. Walls,
  icons and the rest are unchanged.

It does not touch the `.on` stroke, the motion perimeter, the picked room's dashed line, the ghost floor, auras or
icons: those are lines or overlays, drawn after.

**H5. Colour is not the only signal.**

- Every heated room prints its value in the readout line under its name (`text.val[data-rv]`), in the mode's kind
  (the other kind's reading stays as today). Readouts already show at every detail level.
- Under `labels: false` the heat value is still drawn (class `val heat-val`): the viewer asked for the map, and a
  colour with no number fails the rule. Other text stays hidden.
- A legend, built once in core (`heatLegend(kind)`: three stops, the two end labels, the unit) and drawn by each host
  in its chrome: in the card a small strip at the plan's bottom left, only in a heat mode and only in 2D and 2.5D
  ("16 °C" ramp "26 °C"); in the Studio in its status bar. Its text is real text.
- Contrast: the readout keeps its outline stroke (`paint-order:stroke`), so it reads on any ramp colour. Checked in
  shots at 4x on the hottest and coldest room, every theme.

**H6. Themes.** The ramp is fixed; the base it mixes into is each theme's `--fp-room-fill`, so a dark theme gets a
darker version of the same hue and a light theme a lighter one. `ha` follows its fallbacks. `npm run shots` gains heat
states (both kinds, three themes at least: blueprint, light, midnight) and is looked at.

**H7. Views.** 2D and 2.5D: the room fill is the floor at plan level in both, so one rule covers both. **3D: not in
this sprint.** In 3D the card hides the Heat map items and the legend; the viewer's pick is kept and shows again in
2D. Live 3D room colours are a later task (Non-goals).

**H8. The card.**

- Key `heat_map: off | temperature | humidity`. Default `off`. Anything else is `off`, with one console warning.
- The ⋯ menu gets a **Heat map** section after Layers: three radios, Off, Temperature, Humidity, `data-value`
  `heat:off`, `heat:temperature`, `heat:humidity`. Shown under `view_switch: false` (it is data, like Detail and
  Layers); hidden in 3D; no menu under `kiosk`, where the key still applies.
- A pick is a viewer's pick: written to `StoredView.heat`, wins over the YAML, cleared by Reset view, and `heat_map`
  joins `_viewStorageKey`, so editing it in YAML starts a clean memory. `parseStoredView` drops junk.
- A `hass` update keeps the mode (finding: editor and card state survive `hass`).
- The Edit-card form gets a Heat map select; `off` is left out of the YAML.

**H9. The Studio (parity).** View menu, a `#heatSub` submenu with the same three choices, kept in the Studio's view
memory, passed to `renderFloor`. Inside Home Assistant it shows live readings. Standalone there are no states, so no
room is heated and the status bar says "Heat map: no readings". `view-parity.spec.ts` gets the row
`heatSub` → `heat:temperature`; `docs/card.md` the same row.

### What does not change

- **Schema.** No layout change: no new room key, no `validate` or `migrate` change. Both features are card keys and
  view memory. So there is no schema review pass this sprint; the Opus pass checks the two YAML readers and
  `parseStoredView` instead, as untrusted input.
- `DEVICE_TYPES`, `NO_TOGGLE`, `RoomKind`: no new member. New per-member tables (`HEAT_SOURCE`, the heat test over
  `RoomKind`, the favourite button over `DEVICE_TYPES`) iterate the unions, so a later member fails until decided
  (findings 17, 20).

## Acceptance criteria

Favourites:

1. `favouritesOf` returns the cleaned list for every junk shape in F1 (a string, a number, `null`, `{}`, `__proto__`,
   `"light.Kitchen"`, 30 ids, repeats, `favorites` alone, both keys) and never throws; it says when to warn.
2. On a card with `favourites: [light.demo_living, switch.demo_tv_plug, sensor.nope]`, the Overview shows a
   Favourites section above Attention with two rows in that order; `sensor.nope` has none.
3. A real click on an off light's Turn on calls `light.turn_on` once. A real click on an on plug's Turn off calls
   nothing and shows Confirm turn off; a click on Confirm calls `switch.turn_off` once. A sensor row has no button.
4. A real click on a row (not its button) switches to its floor, centres on it and opens its popup.
5. A `"><script>` friendly name is drawn as text (finding 2). A `hass` update keeps the section, the confirm step
   and the scroll.
6. No section under `kiosk` or `active_list: false`, nor at the Floor or Room level.
7. Search for "li" lists a favourite light before a shorter-named non-favourite of the same tier; the Studio's order
   is unchanged.
8. The Edit-card form adds and removes favourites, refuses a repeat and a non-entity, writes `favourites`, drops the
   key when empty, and drops `favorites`.

Heat map:

9. `roomHeat` gives the value, text and `t` for each source rule in H2 and each unit in H3; `null` for every
   non-reading; a room's list wins over a device in it; a device inside a zone feeds the room under it; a fill, a
   structure or a zone never heats. Tests iterate `DEVICE_TYPES` (`HEAT_SOURCE`), `RoomKind` and `HEAT_KINDS`.
10. `renderFloor` with `heat` omitted or `off` is byte for byte as before on the demo, every option set.
11. With `heat: "temperature"` and the shots' `on` states (ground: Living 23.5, its sensor inside the Reading corner
    zone; first: Bedroom `12,5`): Living's polygon has class `heat` and `--fp-heat` 0.75, the zone has neither;
    Bedroom has neither (comma decimal); Living's readout says 23.5 °C at far detail and under `labels: false`; no
    `room-night` polygon is drawn at night. With `heat: "humidity"` the first floor's Bathroom (54) is heated at 0.6.
12. Computed-style pairs in Chromium, every theme: a heated room's fill differs from the same room off and matches the
    ramp at `t` 0, 0.5 and 1; heat beats glow, a painted colour, a texture and water's own rule; an unheated room in a
    heat mode is unchanged. Each pair fails with its rule removed.
13. In the card, a real click on ⋯, Heat map, Temperature heats the plan and shows the legend; a reload keeps it;
    Reset view returns to `heat_map`; in 3D the items and legend are gone and come back in 2D.
14. In the Studio inside the panel harness, View, Heat map, Humidity heats the bathroom; standalone the status bar
    says no readings. `view-parity.spec.ts` passes with the `heatSub` row.
15. `npm run shots` with the heat states, looked at in blueprint, light and midnight, the hottest and coldest room at
    4x.
16. `npm run lint`, `npm test`, `npx playwright test`, each bare, `$?` on its own line; every new Playwright test
    `--repeat-each=10`.

## Non-goals

- Per Home Assistant user favourites, a star in the popup, favourites in the Studio, a favourites card of its own.
- A heat map from history, presence over a day (dropped in S33), a time scrubber.
- A heat map in 3D; interpolated (gradient) fills across a room; a heat map of power, CO2 or light level.
- A new room key to name the heat sensor; `climate` `current_temperature` as a source.
- Card keys for the scale (Q1 default); a per-theme ramp.

## Risks

- **The card file is 4,000 lines** and both lanes touch it (the Favourites section, then the heat menu and legend).
  They run in sequence on it; see the plan.
- **Paint versus data.** Overriding a painted room in a heat mode is a choice (Q3). If Diego dislikes it, the fix is
  one selector (`:not([fill])`) and its pair flips.
- **Legibility.** A mid amber at 55 % under a white readout on a light theme may be weak. The readout's outline
  stroke is the guard; shots at 4x are the check.
- **The Overview grows.** Twenty-four favourite rows push Attention down on a phone. The fold (F2) is the answer;
  a test folds it and finds Attention in view.

## Open questions for Diego (each with the default this plan builds)

1. **Heat scale: fixed or set per card?** Default: fixed, 16 to 26 °C and 30 to 70 %, no key. Other: card keys
   `heat_from` and `heat_to` (and the humidity pair), as `plug_heat_from` and `plug_heat_to`; one task more.
2. **Which sensors feed a room?** Default: the room's own `temps` (or `humidity`) list when any is readable, else the
   sensor devices standing in the room; the number always matches the readout. Other: the mean of both together.
3. **A painted room and night in a heat mode.** Default: the heat fill covers a room's own paint and texture, and the
   night veil is not drawn, so the scale reads true. Other: painted rooms keep their paint, and the veil stays.
