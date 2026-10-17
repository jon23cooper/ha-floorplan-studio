# The car: Sprint 35

Status: Draft 2026-10-17, waits for Diego's yes. Open questions at the end, each with the default this spec builds.
Plan: `docs/PLAN.md`, Sprint 35. Supersedes Sprint 16's S16.1 and S16.2, which were planned on 2026-10-06 and never built.

## Why

Diego, 2026-10-17, five points:

1. A better car. Attach sensors, battery, position. Decide what to attach, what the plan shows, what the popup shows.
2. Selectable models (suv, sedan, wagon, offroad, truck, van, utility, citycar, electric). Procedural low-poly geometry, a
   silhouette in 2D and 2.5D, a real footprint per model, a body colour, a lit state while charging.
3. A tap opens Home Assistant's own more-info dialog, consistent with Sprint 33's `tap_action` and `hold_action`.
4. Away is semi-transparent, and 2D, 2.5D and 3D agree. In 3D the transparency is real and the depth does not look broken.
5. Should the car open a custom card (a Tesla card, any card config) in a popover? Recommend.

## What the code does today (0.32.0)

A car can be three different things. None has a state worth the name.

- **Furniture symbol `car`** (`FURNITURE.car`, `src/core/icons.ts`): a 450 x 180 cm rounded box with two window
  rectangles, drawn in a 100 x 100 frame scaled to the piece's `w` and `h` and turned by `rot`. 2.5D: a box prism
  (`FURNITURE_SOLID.car = "box"`) 150 cm high with the symbol on the lid. 3D: one prism, `scene-build.ts`. It may name an
  `entity`, but only a tv, speaker or computer piece is "linked" (`pieceDevice`, `src/core/solids.ts`), so a car's entity
  does nothing: no colour, no tap.
- **Device type `car`** (`DEVICE_TYPES`): an icon tied to one entity. `classOf` falls to the default rule (on or open is
  on), so a `device_tracker` car is always off. `car` is **not** in `NO_TOGGLE` (`src/card/actions.ts`), so the popup
  follows the entity's domain (finding 20 was never decided for it). Active `never`, Attention `none`, floor-off `null`,
  room row `more-info`.
- **Unlinked appliance `car`** (`UNLINKED_TYPES`): an icon with `attached` entities "for reference only", a flat `color`,
  `scale`. A tap opens the card popup, a hold the chooser when it names several entities. In 2.5D and 3D a 40 cm box.

Also relevant:

- **A person away** (S7.8): `classOf` is on at `home`; `personClass` adds `home` or `away`; `.dev-person.away{opacity:.35}`
  and a small grey `away-mark` dot. Unavailable wears the gone mark. The 3D overlay draws the same icon markup, so a
  person fades in 3D too.
- **Linked pieces in the card** (`src/card/actions.ts`): a tap and a hold on a linked piece both fire `hass-more-info` for
  its entity. `tap_action` and `hold_action` apply to device icons only; doors, appliances and linked pieces keep what
  they do (S33 X2). **Kiosk leak:** the piece branch never checks kiosk, so on a kiosk card a tap on a linked tv opens
  Home Assistant's dialog, which `docs/card.md` says kiosk never does. Found while planning; S35.6 proves it test first.
- **The chooser** (`_openChooserDialog`): one row per entity, its name and its state, a tap on a row opens that
  entity's more-info.
- **3D.** Furniture is prisms only (`Shape` is `prism` or `point`). Linked pieces get their own meshes
  (`buildPieces`, `applyPieces`) recoloured from `Live3D.pieces[i].on`. Transparent materials exist only for glass
  (`opacity` 0.35, `depthWrite: false`, `renderOrder` 1).
- **The Studio is flat.** It draws 2D only; it has no 2.5D or 3D preview. The Studio's car is what `renderFloor` draws.
- **Size.** The card file is 117,117 gz against a 118,000 cap (`size-budget.spec.ts`, Diego 2026-10-17): 883 bytes of
  room. The 3D chunk is 156,003 gz against 233,000.

## What Home Assistant offers for a car

Read from Home Assistant core `dev` on 2026-10-17 (`homeassistant/components/<name>/`), and from the custom
integrations' READMEs. Every car integration exposes the same few kinds of entity, under different names. So the card
reads them by **domain, device class and state**, never by integration.

| Integration | Position | Charging | Plug | Battery, range | Locks, openings | Other |
|---|---|---|---|---|---|---|
| Tesla Fleet, Teslemetry (core) | `device_tracker` location and route | `sensor` enum `charge_state_charging_state`: starting, **charging**, stopped, complete, disconnected, no_power | `binary_sensor` charge cable | battery level %, range km | `lock`, `cover` (trunk, windows) | climate, tyre pressure warnings (`binary_sensor` problem), odometer |
| Tessie (core) | `device_tracker` | `binary_sensor` `battery_charging`, and the same enum | `binary_sensor` connectivity (cable) | as Tesla | `lock`, `cover` | climate, tyre warnings |
| Renault (core) | `device_tracker` | `binary_sensor` **`battery_charging`**; `sensor` charge state `charge_in_progress` and others | `binary_sensor` **`plug`** | battery %, range | `lock` (not every model) | hvac `binary_sensor` |
| Volvo (core) | `device_tracker` | `sensor` enum `charging_status`: **charging**, discharging, done, error, idle, scheduled | | battery %, range, fuel | `lock`, door and window `binary_sensor`s | |
| BMW and Mini | Core `bmw_connected_drive` is now a stub that raises "integration removed" and points to the custom `bmw-cardata-ha` | charging state sensors (custom) | | SOC, range | | |
| Hyundai, Kia (`kia_uvo`, custom) | `device_tracker` | `binary_sensor` charging | `binary_sensor` plugged | EV battery %, range, fuel % | `lock`, door `binary_sensor`s | tyre warning, odometer |
| VW (custom `volkswagencarnet`, `volkswagen_we_connect_id`) | `device_tracker` | charging state | plug | battery %, range | `lock`, doors, windows | climate |
| OBD (ESPHome ELM327, Torque) | rarely | | | fuel %, voltage | | engine speed |
| Generic | a phone or tag `device_tracker`, a `person` | a charger's own `switch` or `sensor` | | | | |

So, what a car piece reads:

- **Position:** a `device_tracker.*`. Its state is already resolved by Home Assistant against its zones: `home`,
  `not_home`, or a zone's name. GPS needs no maths of ours (S16.2's GPS fallback is dropped, see C5).
- **Charging:** a `binary_sensor` with `device_class: battery_charging` that is `on`, or a `sensor` whose state is
  `charging` or `charge_in_progress` (case ignored). That covers every core integration above.
- **Level:** a `sensor` with `device_class: battery` and unit `%`; else a `sensor` with unit `%` whose entity id holds
  `fuel`. One number.
- **Alert:** a `lock.*` that is `unlocked` or `open`, or a `binary_sensor` with device class `door`, `window`, `opening`
  or `garage_door` that is `on`.
- **Everything else** (range, odometer, tyre pressure, climate, plug, cable): listed with its state in the chooser and
  in Home Assistant's dialog; not interpreted on the plan.

## Decisions

### C1. The car is a furniture piece

A car piece (`symbol: "car"`) is the car. It already has what a car needs: a real footprint (`w`, `h`), a turn (`rot`),
a height and a bottom, a name and an entity, a block in 2.5D and a prism in 3D. A device icon has no footprint; an
unlinked appliance is an icon with a scale. KISS: extend the piece, not a third thing.

- The **device type `car`** and the **unlinked `car`** stay valid and draw as today, so no layout breaks. Two small
  changes: `car` joins `NO_TOGGLE` (finding 20: a tap must never switch a car), and a car **device** whose entity is a
  `device_tracker.*` wears `away` like a person (C5), because a car icon that is away should fade too.
- The Studio offers **Convert to car piece** on a device or unlinked appliance of type `car` (C9). Q2.

### C2. Schema: three optional keys on a car piece

```ts
export type CarModel = "sedan" | "wagon" | "suv" | "offroad" | "truck" | "van" | "utility" | "citycar" | "electric";
export const CAR_MODELS: readonly CarModel[] = [/* that order */];
export const MAX_CAR_ATTACHED = 24;
interface Furniture { /* as today */ model?: CarModel; color?: string; attached?: string[] }
```

- `model`: the model. Absent reads as `sedan`.
- `color`: the body colour, `#rrggbb`. Absent is the theme's furniture colour.
- `attached`: the car's other entities, at most 24, in the order the user gave.
- `entity` (exists): the car's **main entity**, the one a tap opens. Absent: the first `attached` entity is the main one.
- All three are allowed on a `car` piece only.
- **No schema bump.** Layout `version` stays 2. An older card ignores the three keys and draws the old car, as it did
  for `fx` and `views`.

Untrusted input (findings 1, 12):

- `validate` never throws. It reports, naming the piece: `model` not in `CAR_MODELS`; `color` not `#rrggbb`; `attached`
  not a list, an item that is not an entity id, a repeat, more than 24; any of the three on a piece that is not a car.
  The lookup is `includes` on the list, so `__proto__` or `constructor` never match.
- `migrate` keeps what `validate` would accept and drops the rest, so a file from a newer version (a model we do not
  know yet) loads as a sedan instead of failing: an unknown or junk `model` is deleted; a bad `color` is deleted;
  `attached` keeps the entity-id strings in order, first of a repeat, at most 24, and is deleted when empty or not a
  list; the three keys are deleted from a non-car piece. A layout run through `migrate` then passes `validate`.
- Every writer (Studio) keeps a layout valid; a test runs `validate` after every combination of its inputs (C9).
- `attachedEntities` (`src/core/bind.ts`) counts a car's `attached` (and its main `entity` stays "placed"), so an
  attached entity is not offered again as an icon, as for an appliance.

### C3. Models and footprints

A **default per model**: the footprint and height below, from the makers' published figures for a typical car of that
class, rounded. A car is drawn, not measured; the user can type any size after (5 to 2000 cm, as any piece).

| Model | Label | L x W x H (cm) | Like |
|---|---|---|---|
| `sedan` | Sedan | 470 x 182 x 145 | VW Passat, BMW 3 Series |
| `wagon` | Wagon | 478 x 183 x 150 | Passat Variant, Volvo V60 |
| `suv` | SUV | 465 x 188 x 168 | VW Tiguan, Toyota RAV4, Volvo XC60 |
| `offroad` | Off-road | 480 x 196 x 195 | Land Rover Defender 110, Jeep Wrangler 4-door |
| `truck` | Pickup truck | 590 x 203 x 196 | Ford F-150 SuperCrew (Diego, 2026-10-17: truck is the F-150, a full-size pickup with an open bed) |
| `van` | Van | 495 x 195 x 197 | VW Transporter, Ford Transit Custom |
| `utility` | Utility (hatchback) | 429 x 179 x 148 | VW Golf (Diego, 2026-10-17: utility is a golf, a compact hatchback with a short, near-vertical tail, not a van) |
| `citycar` | City car | 360 x 165 x 150 | Fiat 500, VW up! |
| `electric` | Electric (Tesla-like) | 472 x 185 x 144 | Tesla Model 3 |

- Length is the piece's `w` (along x at `rot` 0), width its `h`, as the symbol is today. The **front is +x**: at `rot`
  0 the car points right. It turns with the piece, about its centre, in every view (C4, C6).
- A new car piece is a sedan at 470 x 182. `FURNITURE.car` becomes 470 x 182 (finding 19: tests that pinned 450 x 180
  move to the new premise and say so).
- Height: `furnitureHeight` of a car with no `height` is its model's H. `FURNITURE_HEIGHTS.car` stays as the sedan's
  145 for the panel's placeholder.
- Picking a model in the Studio sets `w` and `h` to its footprint and deletes `height`, in one undo step (C9). A size
  the user typed is replaced; that is what picking a model means. Undo brings it back.

### C4. One shape, three views

One table in a new `src/core/car.ts`, `CAR_SPEC: Record<CarModel, CarSpec>`, holds per model the footprint and a
profile in fractions of the length, from the tail (0) to the nose (1):

| Model | Nose, tail chamfer | Rear glass from | Roof from | Roof to | Windscreen to | Belt (of H) | Cabin width | Grille | Bed |
|---|---|---|---|---|---|---|---|---|---|
| sedan | .07, .06 | .20 | .32 | .58 | .70 | .55 | .86 | yes | |
| wagon | .07, .04 | .04 | .08 | .58 | .70 | .55 | .86 | yes | |
| suv | .06, .04 | .04 | .08 | .62 | .73 | .58 | .88 | yes | |
| offroad | .03, .03 | .05 | .07 | .66 | .72 | .58 | .92 | yes | |
| truck | .05, .03 | .40 | .42 | .64 | .72 | .58 | .90 | yes | .02 to .40 |
| van | .05, .02 | .02 | .03 | .80 | .88 | .50 | .92 | yes | |
| utility | .06, .03 | .03 | .05 | .70 | .80 | .52 | .90 | yes | |
| citycar | .10, .08 | .08 | .14 | .60 | .74 | .55 | .86 | yes | |
| electric | .10, .07 | .08 | .26 | .56 | .74 | .50 | .86 | **no** | |

These are starting values (judgement, S35.2): the builder tunes them by looking at the shots, and the final numbers go
in DECISIONS. The order holds for every model: rear glass from <= roof from <= roof to <= windscreen to.
The electric car is the smooth low saloon: long raked glass front and back (a fastback), the lowest belt, the
roundest nose, no grille.

`carParts(model)` turns the profile into plan polygons in a unit frame (-0.5..0.5 on both axes, +x the nose): the body
outline (the footprint with its four corners chamfered), the rear glass, the roof, the windscreen, two mirrors, the
truck's bed, four wheel boxes, the grille. Every view takes the same polygons, scales them by `w` and `h`, turns them by
`rot` about the piece's centre (`turnAbout`) and so cannot disagree. `carParts` never throws: an unknown model is a
sedan.

- **2D** (`renderFloor`, the one draw path, finding 8): the car piece draws `carTop(model)` in place of the old symbol,
  in the same scaled and turned group: body outline in the body colour, glass in `--fp-glass`, roof a little darker
  than the body, mirrors, the bed in the body colour mixed with `--fp-ink`. A **top-view silhouette per model**, not an
  icon. Paths are generated from the polygons, not stored per model, so nine models cost one table and one function in
  the card file.
- **2.5D**: two prisms instead of one box. The body outline from the piece's bottom to the belt, with the top view on
  its lid; the cabin (roof rectangle at the cabin width) from the belt to the full height, its sides in `--fp-glass`, its
  lid the roof. Same `nearest` sort key as today.
- **3D** (lazy chunk, `scene-build.ts` and the viewer): low-poly from these primitives:
  - body: a prism of the outline from 18 cm (ground clearance) to the belt;
  - greenhouse: a **loft**, a new shape `{ type: "loft", base, top, z0, z1 }` from the glass footprint at the belt (rear
    glass from to windscreen to, cabin width) to the roof footprint 4 cm under the top (roof from to roof to, cabin
    width less 8 %), so windscreen and rear glass slope. Both rings convex, the same number of points;
  - roof: a 4 cm prism of the roof footprint, body colour;
  - wheels: four boxes 64 cm high and 22 cm wide, outer face flush with the body side, axles at .18 and .80 of the length
    (.16 and .82 for offroad, truck and van), so the body hides their tops as arches would;
  - grille: a thin dark plate on the nose, every model but `electric`;
  - the truck's bed is the body at belt height, open-topped look not attempted (a cover).
  Each part is a solid with `kind: "furniture"`, the piece's `index` and entity, and a role (C7). A tap on any part is a
  tap on the car.

The Studio has no 3D view (it is flat on purpose, `docs/editor.md`), so "the Studio's 3D preview" is the 2D plan plus a
small top-view swatch beside the Model select (C9). Nothing else is built for it.

### C5. State: home, away, charging, level, alert

`carStatus(m, states)` in `src/core/car.ts`, pure, never throws, reads the main entity and `attached` in order:

- **tracker**: the first `device_tracker.*` among them. None: the car has no home or away (drawn as home, no mark).
- **home** when its state is `home`; **away** when it is any other text but `unknown`, `unavailable` or empty
  (`not_home`, a zone's name); **unknown** otherwise. The zone is the state text, `not_home` reads "Away".
- **charging**, **level**, **alert**: the rules under "What Home Assistant offers", first match in order.
- **text** (`carText`): one line, the same for the hover, the chooser's title and the Active row: `Home`, `Away`,
  `Away · Work`, then `· Charging`, then `· 78 %`. Built as text, escaped where it is markup (finding 2).

What it means on the plan, in every view:

| State | 2D and 2.5D (`renderFloor`) | 3D |
|---|---|---|
| home | as drawn | as drawn |
| away | the piece's group at 35 % opacity (`.furn-car.away`), the away mark at the nose | every part at 35 %, real transparency (C6); the away mark as an overlay badge |
| charging | the outline in `--fp-dev-car`, a bolt badge | the greenhouse in `--fp-dev-car`, lit like a tv screen; the bolt badge |
| alert | the outline in `--fp-open-door` (as an open door) | the roof in `--fp-open-door` (the door's role, `open-door`) |
| level | a value under the car, `78 %`, hidden at far detail as device values are | the overlay value under the badge |
| main entity dead | the gone mark, as every device (S23.5) | the same badge |

- Charging wins over alert for the outline colour; the alert still shows in the text. Away and charging can both hold
  (a car charging at a public charger is away and charging).
- `--fp-dev-car` is new: light `#2e9e4f`, midnight `#4fd17a`, solarized `#859900`; the generated themes take
  `devFor("car")`, as every type without its own does (as for `fan`, S33.1). A charge light is green in most cars.
- A **car device icon** (type `car`) whose entity is a `device_tracker.*` gets `away` and the away mark as a person does
  (one condition in `personClass`). An unlinked car is unchanged: by its own definition nothing drives its icon.

Per-type tables (findings 17, 20), for the type `car`, which is also what `pieceDevice` reports for a car piece:

| Table | Today | Sprint 35 | Why |
|---|---|---|---|
| `NO_TOGGLE` | absent | **in** | a car is watched; a tap never switches it |
| `ACTIVE_LIST_RULE` | `never` | **`on`**, and `classOf` of a car is on while charging | a charging car is something running in the house |
| `ATTENTION_RULE` | `none` | `none` | an open car door is not a house alarm; Q7 |
| `FLOOR_OFF_GROUP` | `null` | `null` | All off never touches a car |
| `ROOM_ROW_TAP` | `more-info` | `more-info` | as the plan's tap |
| `CATEGORY_OF` | `other` | `other` | |
| `HEAT_SOURCE` | `null` | `null` | |
| `DEVICE_SOLID` | `none` | `none` | the icon car stays an icon |
| `FURNITURE_SOLID` | `box` | `box` (the car path branches on the symbol) | |

`pieceDevice` reports a car piece as a device `{ type: "car", entity: main, attached }` when it has a main entity. Then
Active, Search, Favourites, room rows and the 3D live state all see the car through the one function they already use.

### C6. Away in 3D is real transparency, without broken depth

Fading several meshes that overlap (wheels under a body, a cabin on a body) with plain `transparent: true` shows their
inner faces through each other, and the draw order flickers as the camera moves. The fix is the standard one:

- For an away car, each part gets a **depth pre-pass** twin (`colorWrite: false`, `depthWrite: true`, `renderOrder` 1)
  and its own material turns `transparent: true`, `opacity` 0.35, `depthWrite: false`, `depthFunc: LessEqualDepth`,
  `renderOrder` 2. Only the nearest surface of the car is drawn, once, at 35 %: the wheels behind the body do not show
  through it, the floor and walls behind the car do.
- Opaque things (floor, walls, other furniture) draw first at `renderOrder` 0, so what stands behind the car shows.
  Window glass (`renderOrder` 1) behind an away car may sort against it; accepted, and named in Risks.
- Home again: the twins are hidden and the materials go back to opaque, in place, with no rebuild (as `applyPieces`
  recolours today).
- Reduced motion has no say: nothing animates.
- The overlay badge (C5) is drawn by the card's own stylesheet, so its fade is the 2D one.

### C7. Colours: through `--fp-*` only

- Body: `color` when set, as a user colour is on a room (data, validated `#rrggbb`); else `var(--fp-furniture)`. In 2D
  and 2.5D it reaches the drawing as a custom property on the group, `style="--fp-car-body:#c03030"`, and a class rule
  reads it: `.furn-car .car-body{fill:var(--fp-car-body,var(--fp-furniture))}`. A rule, not a presentation attribute,
  so the editor's or any author rule cannot outrank it by accident (finding 18), and it gets its computed-style pair.
- 3D roles (new, in `src/card/three/palette.ts`): `car-body` (the paint's `color`, else the furniture mix), `car-glass`
  (`--fp-glass` mixed 60 % into `--fp-ink`, opaque: a car's glass is dark), `car-tyre` (`--fp-ink` mixed 80 % into
  `--fp-bg`), `car-trim` (the grille, `--fp-ink`), `car-charge` (`--fp-dev-car`). A test holds every role known
  (`isKnownRole`).
- Nothing reaches a style as raw layout text: `color` passes the hex check in `migrate` and is still escaped.

### C8. Tap, hold and the card's popup (point 3)

| Gesture | Car piece | Why |
|---|---|---|
| Tap | Home Assistant's **more-info of the main entity** | Diego's ask. The main entity is the tracker in the common case: its dialog shows the map, the zone, and through Related the car's device and every other entity. It is also what every linked piece already does on a tap. |
| Hold (500 ms) | the card's **chooser**: the title is the car's name and `carText`, then one row per entity (main first, then `attached` in order) with its state; a row opens its more-info | one look at battery, range, charging, locks; one more tap to Home Assistant. It is the existing chooser, so no new dialog in a full card file. |
| Active row, Search, Favourites row | as a tap (go to the car, more-info) | a linked piece's row is its tap on the plan, today's rule |
| Hover | tooltip: name and `carText` | as every device |
| Kiosk | a tap does **nothing**; no hold | kiosk never reaches Home Assistant's dialog (`docs/card.md`); the same fix for every linked piece (Q4) |

`tap_action` and `hold_action` stay as Sprint 33 made them: card-wide, **device icons only**. A car piece, like every
linked piece, door and appliance, keeps its own gestures (S33 X2). That is the consistency: one rule for pieces, and a
car piece's tap is more-info as a linked tv's is. A **car device icon** follows `tap_action` like any icon; with `car` in
`NO_TOGGLE` its popup has no switch button, and `toggle` opens the popup.

Why not the card's popup on a tap: Diego asked for Home Assistant's dialog, the popup would have no button (a car has
nothing to switch), and a piece popup would be a new subject kind in the card file. Why not follow `tap_action` with a
car default: `tap_action`'s default is `popup`, so the car would need a per-type default, a second rule beside S33's.

### C9. The Studio

The furniture panel, when the piece is a car, gets a **Car** block:

- **Model**: a select of the nine labels (C3), with a small top-view swatch drawn by `carTop`. A pick sets `model`, `w`,
  `h` and deletes `height`, one undo step; picking the same model is no step (finding 6).
- **Colour**: the layout's `palette` swatches, a colour input, and **Theme colour** (deletes `color`). A custom colour
  joins `layout.palette` in the same step, as room paint does (`EditorState.paint`).
- **Main entity**: the existing entity field, labelled "main entity (a tap opens it)". Suggestions put `device_tracker.*`
  first.
- **Attached**: the existing `multiAttachField`, choices ordered: entities of the main entity's Home Assistant device
  (`dev`), then entities whose name holds the car's name, then the car domains (`device_tracker`, `sensor`,
  `binary_sensor`, `lock`, `climate`, `cover`, `switch`). Diagnostic entities (`cat`) last. **Add all from this car**
  adds every entity of the main entity's device not yet attached, up to 24, one undo step; it is shown only when there
  is one.
- **Convert to car piece** on a device or unlinked appliance of type `car`: one undo step replaces it with a car piece
  at the same point and turn, `entity` (device) or `attached` (appliance) carried over, `color` and `name` kept, a sedan.
- Every writer here is tested over every combination of its inputs, `validate` after each and after Undo and Redo
  (finding 12).

Standalone (no Home Assistant) the attached picker takes typed entity ids, as the other pickers do.

### C10. Card and Studio parity

Everything the car shows on the plan is drawn by `renderFloor`: the Studio and the card show the same model, colour,
away, charging and alert (the Studio inside Home Assistant has live states; standalone it has none and draws the car
as home). No new View control, so no `view-parity.spec.ts` row. The panel is Studio only, as all editing is. The tap,
hold and chooser are card only, as all of them are (a Studio click selects). 3D is card only (the Studio has none).
Each DECISIONS line says which.

### C11. A custom card in a popover (point 5): not now

Ways a custom card could show any card config:

1. **`window.loadCardHelpers()` then `createCardElement(config)`.** Defined by the Lovelace panel
   (`ha-panel-lovelace.ts`: `window.loadCardHelpers = () => import("./custom-card-helpers")`). Not in Home Assistant's
   developer docs, widely used by HACS cards, stable in practice since 2020. It exists only once a dashboard has loaded,
   so the Studio panel may not have it.
2. **Home Assistant's dialog**, through the `show-dialog` event (`{ dialogTag, dialogImport, dialogParams }`,
   `make-dialog-manager.ts`). A private frontend contract, and its dialog base elements have changed more than once, so
   a dialog we ship would break on a frontend update.
3. **browser_mod**: `fire-dom-event` sends `ll-custom` (`handle-action.ts`), which only browser_mod listens to; its
   `popup` shows a card. Robust, popular, but a third-party integration the user must have.
4. **Navigate** to a subview that holds the user's car card. Stable, no private API, but it leaves the plan.

Security. A layout is untrusted (finding 1): an LLM or a stranger writes it, and it is public. A card config in it could
name an `iframe` card on a third-party URL (a runtime request we forbid, finding 9), a `markdown` card whose Jinja runs
on the server, or any installed `custom:` element with chosen options. So a card config must never live in the layout;
it belongs in the card's YAML, which the dashboard owner writes, like every other card on the dashboard.

Size. A YAML key, a sheet that hosts a child card and passes it `hass` on every update, focus and Escape, the fallback
when the helpers or the card type are missing, and the Edit-card form: about 600 to 900 gz in the card file, which is at
its cap.

**Recommendation: not now, not in Sprint 35.** Point 3's more-info already reaches every car entity, and the hold's
chooser gives the glance. Put it on "Later, not planned" with this design: card YAML key `car_cards`, a map from the
car's main entity to a card config; the car's hold opens it in the card's own sheet through `loadCardHelpers`, never
Home Assistant's dialog; missing helpers or an unknown card type fall back to the chooser with one console warning;
nothing in the layout. Q5.

## Acceptance criteria

Schema and status:

1. `validate` reports, and never throws on, each junk shape in C2: `model` `"Sedan"`, `"__proto__"`, `5`; `color`
   `"red"`, `"#12345"`; `attached` `"x"`, `[5]`, `["light.x","light.x"]`, 25 ids; any of the three on a `sofa`. A car
   with all three valid passes. `migrate` turns each junk case into a layout `validate` accepts, keeps the valid parts,
   and a layout saved with the keys keeps them through `migrate` and `validate`.
2. `carParts` for every member of `CAR_MODELS` (the test iterates the union, finding 17) gives convex wheel and glass
   polygons inside the outline, the profile order of C4, and the footprint of C3; an unknown model gives the sedan's.
3. `carStatus` gives home, away (`not_home`, `Work`), unknown (`unavailable`, `unknown`, `""`, none), charging (each
   rule of the table: Renault's `binary_sensor`, Tesla's and Volvo's enum `charging`, Renault's `charge_in_progress`, a
   `stopped` that is not), level (battery before fuel; a `%` with no fuel in its id is not fuel), alert (unlocked lock,
   open door `binary_sensor`), and never throws on states that are `null`, numbers or objects with throwing getters.
   States in the tests are copied from the integrations' value lists above (finding 21).
4. The per-type table test iterates `DEVICE_TYPES` and holds `car` to C5's column; `NO_TOGGLE` has `car`.

Plan:

5. `renderFloor` with no car piece, or a car piece with none of the new keys and no states, is byte for byte as before
   except the car's own group (the old symbol becomes the sedan's silhouette; the test says so).
6. For each model the 2D group carries its silhouette; at `rot` 90 the nose points down the screen (+y) in 2D, 2.5D and
   3D (the windscreen polygon's centre is below the roof's).
7. Computed-style pairs in Chromium, every theme: the body takes `color`, and the theme's furniture colour without it;
   away is opacity 0.35 on the group; charging strokes the outline in `--fp-dev-car`; alert in `--fp-open-door`;
   charging beats alert. Each pair fails with its rule removed (finding 10).
8. `npm run shots` gains a car on the demo's ground floor in three states (home charging, away at `Work`, home with an
   open door), each of the nine models in a row (a test-only floor), light, blueprint and midnight, 2D and 2.5D, a 4x
   crop of the car. Looked at before `--accept` (finding 16).

3D:

9. The scene of a car piece has the parts of C4 for its model, every part carrying the piece's index and entity, the
   greenhouse a `loft`; `electric` has no grille. A real tap on the body, a wheel and the glass each fire more-info for
   the main entity.
10. Away: every part's material is transparent at 0.35 with `depthWrite` false, and has a pre-pass twin. A pixel test:
    from a camera where a far wheel lies behind the body, the pixel there is the same (within 3 of 255 per channel)
    with the wheels shown and hidden through the test hook; and it differs from the home pixel. Home again restores
    opaque materials with no rebuild.
11. Charging lights the greenhouse in `--fp-dev-car`; an alert turns the roof `open-door`; the overlay shows the bolt
    badge, the away mark and the level where 2D does.

Card:

12. A real click on a car piece (2D, 2.5D and 3D) fires `hass-more-info` with the main entity, whatever `tap_action`
    says; with no `entity`, the first attached one. A real 600 ms hold opens the chooser titled with the name and
    `carText`, rows in order with their states; a click on the battery row fires its more-info.
13. Kiosk: a real tap on a car piece and on a linked tv piece fires nothing; this fails on 0.32.0 (the leak).
14. A car device icon with `tap_action: toggle` opens the popup with no switch button; a `device_tracker` car icon at
    `not_home` is at 35 % with the away mark.
15. The Active list shows a charging car and not a parked one; its row opens more-info. A `"><script>` car name and
    zone are text (finding 2). A `hass` update keeps the chooser open and refreshes its states.

Studio:

16. Model, colour, main entity, attached, Add all from this car and Convert, each with real clicks: one undo step each,
    none for an unchanged value, `validate` after every step and after Undo and Redo. The swatch draws the model's
    silhouette. Attached suggestions put the main entity's device first.

Size and suite:

17. The card file's growth is measured after each card-file task and reported; the total is within the cap Diego sets
    (Q1). The 3D chunk stays under 233,000.
18. `npm run lint`, `npm test`, `npx playwright test`, each bare, `$?` on its own line; every new Playwright test
    `--repeat-each=10` (finding 13).

## Non-goals

- A custom card in a popover (C11, Later).
- Moving the car on the plan by GPS; drawing it at a zone on a map.
- Car alerts in Attention (Q7); an engine-running state; commands (lock, unlock, start climate, open the charge port)
  from the card. Home Assistant's dialog has them.
- Wheels as cylinders, doors that open, headlights; textures on the body.
- A 2.5D or 3D preview in the Studio.
- Retyping existing device or unlinked cars by themselves (Convert is the user's choice).

## Risks

- **The card cap.** Estimated growth in the card file: schema and migrate about 200 gz, the car table and the 2D and
  2.5D drawing about 500, `carStatus` and the per-type changes about 300, CSS about 150, the gestures about 100: about
  1,250 gz, against 883 bytes of room. Q1 asks for the cap. If it stays at 118,000, the first to drop are the level
  value and the alert outline (C5), then the 2.5D cabin prism (a single box again).
- **Depth.** The pre-pass hides the car's own inner faces. Window glass behind an away car may still sort wrong for a
  frame; named, not fixed.
- **Three cars.** A user may have a car device, an unlinked car and a car piece. The device and unlinked cars keep
  working; Convert and the docs point to the piece.
- **Profile numbers** are judgement. A model that looks wrong is a number in one table; the shots are the check.
- **Integration drift.** Charging states are read by value (`charging`, `charge_in_progress`); a new integration with
  another word reads "not charging" until a word is added. The table is one list, tested.

## Answers (Diego, 2026-10-17)

Defaults accepted for 1, 2, 3, 5, 7 and 9; 4 yes. Q1: the card size cap is 119,000 gz. Q6 changed: `truck` is a Ford F-150
pickup (open bed), `utility` is a VW Golf (hatchback); the footprints above are those cars'. Q8 changed: the body colour
is user-selected (any hex, the layout's palette offered, default the theme's furniture colour); tyres are black and the
glass is black (`car-tyre`, `car-glass` stay near-black in every theme, never themed light). The builders use these
answers; the "Other" options below are not built.

## Open questions for Diego (each with the default this spec builds)

1. **The card size cap.** Default: raise it to 119,000 gz for this sprint (about 1,250 needed, 883 free). Other: hold
   118,000 and drop the level value, the alert outline and the 2.5D cabin.
2. **Which object is the car.** Default: the furniture piece, with a footprint, a model and attached entities; device and
   unlinked cars keep working, and the Studio offers Convert to car piece. Other: put the model and footprint on the
   device type `car` (a device with a size, new to the schema).
3. **Tap and hold.** Default: a tap opens Home Assistant's more-info of the main entity, a hold the chooser with every
   car entity and its state; `tap_action` and `hold_action` stay for device icons only, as for every linked piece.
   Other: the car follows `tap_action` with a default of its own.
4. **Kiosk.** Default: a tap on a car, and on any linked piece, does nothing in kiosk, as the docs promise. Other: kiosk
   allows more-info on pieces, and the docs change.
5. **A custom car card in a popover.** Default: not now; "Later, not planned" with the C11 design (card YAML only, the
   card's own sheet, `loadCardHelpers`). Other: a task in this sprint, after the cap is settled.
6. **What `truck` and `utility` mean.** Default: `truck` is a pickup with an open bed; `utility` a compact van (Berlingo,
   Caddy). Other: `truck` a box lorry, `utility` a pickup ("ute").
7. **What the plan shows.** Default: away fade and mark, charging in green with a bolt, alert outline for an open door
   or an unlocked lock, the battery or fuel % under the car; no car rows in Attention. Other: less (no level, no alert),
   or alerts in Attention too.
8. **Body colour.** Default: the theme's furniture colour, any `#rrggbb` per car, the layout's palette offered. Other: a
   fixed list of car colours.
9. **Default model.** Default: sedan, which existing car pieces become (their old rounded box is replaced). Other: keep
   the old symbol when `model` is absent.
