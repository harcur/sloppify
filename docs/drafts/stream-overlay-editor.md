# Draft: stream overlay editor, second design

Status: **draft for review**, nothing built yet. Once agreed, the decisions move into `docs/DECISIONS.md` and this file goes.

## What's wrong today

The editor grew one option at a time, and each option got its own block in one long column (zones, selected zone, art, layout, use it: about 1,900 px tall on desktop, 2,800 px on a phone).

1. **Previewing is hard.** The preview is small (38 % of the screen height on phones, about 550 px wide on desktop) while the controls are a long scroll beside or below it. Zone outlines, names, grips and striped stand-ins sit on top of the art all the time; the only way to see the result is a checkbox under the preview, and even then you only see a small, scaled-down version. You can't see the back and front layers apart, or the overlay at full size.
2. **Deleting is decoupled.** "Remove zone" is a small red link at the very bottom of the zone settings, under four sliders, far from both the zone on the stage and its name in the zone list. There's no Delete key and no undo, so removing a zone by mistake loses its settings.
3. **One thing, three places.** A zone is selected in the list, added with a separate dropdown and button, and edited in a third block. The stage, which is where you think about zones, does nothing but move and resize.
4. **No hierarchy.** A seldom-used setting (canvas size) has the same weight as the one you change all the time (effect). "Starting layout" replaces the whole design but sits in the middle of the settings.
5. **Not an app on phones**, unlike every other tool (TOOL-GUIDELINES 4.1): the page scrolls, and the sticky preview covers a third of the screen while you scroll settings under it.

## Principles

- **The stage is the editor.** Select, edit, duplicate and delete a zone where it is, the way sign document edits its items: a small toolbar next to the selected thing.
- **One list of zones**, holding everything you do to zones as a set: select, add and delete.
- **Edit and preview are two modes of the same stage**, one key or tap apart, plus a full-screen preview at real size.
- **Undo instead of confirm.** Every change can be undone, so deleting is one click with no dialog.
- **Three tabs, ordered by how often you use them:** Zones, Art, Use it.
- Link format and `design.js` don't change, so every existing link keeps working.

## Desktop (900 px and up)

```
┌──────────────────────────────────────────────────────────┬──────────────────────┐
│ stream overlay                                           │ [Zones] Art  Use it  │
│ ┌ Edit | Preview ┐  ↶ ↷          New pattern    ⛶       ├──────────────────────┤
│ ├────────────────────────────────────────────────────┐   │ ▣ camera   raised  ✕ │
│ │ info panel ┄┄┄┄┄┐                                  │   │ ▣ chat     sunken  ✕ │
│ │ ┊              ┊      art art art                  │   │ ▣ info     orbit   ✕ │
│ │ └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘                       ┌┄chat┄┄┐  │   │ + Add zone ▾         │
│ │   ┌──────────────────────────────┐     ┊       ┊  │   ├──────────────────────┤
│ │   │ raised ▾ │ under ▾ │ ⧉ │ ✕  │     ┊       ┊  │   │ camera               │
│ │   └──────────────────────────────┘     ┊       ┊  │   │ Effect  [grid]       │
│ │ ┏camera━━━━━━━━┓                       └┄┄┄┄┄┄┄┘  │   │ Content sits  ○ ●    │
│ │ ┃              ┃                                   │   │ Strength ───●──      │
│ │ ┗━━━━━━━━━━━━━◢┛                                   │   │ ▸ Shape              │
│ └────────────────────────────────────────────────────┘   │ ▸ Position and size  │
└──────────────────────────────────────────────────────────┴──────────────────────┘
```

- **The stage gets the room**: as wide as the column allows, up to 80 vh tall. The intro paragraph shrinks to one line under the title.
- **Stage toolbar** (above the stage, one row): Edit / Preview switch, Undo, Redo, New pattern, Full screen. The "Show zones" checkbox and the help paragraph go (the help becomes the stage's `aria-describedby` text and a `title`).
- **Zone toolbar** floats above the selected zone (below it when there's no room), kept inside the stage, as in sign document: effect (dropdown), content sits over / under (two-state button), duplicate, delete. It hides while dragging and comes back on release.
- **Side panel**: 340 px, three tabs. Selecting a zone on the stage switches to the Zones tab.

### Zones tab

- **Zone list**, one row per zone: name, effect in muted text, and a delete button (✕, `aria-label` "Remove camera"). The selected row is filled. Clicking a row selects the zone on the stage.
- **Add zone** is one button that opens a short menu of kinds (camera, chat, game, …); choosing one adds it in the middle of the stage, selected. Replaces today's dropdown plus button. At the 12-zone limit the button is disabled with the existing note.
- **Selected zone**, under the list:
  - **Effect** as a two-column grid of named buttons (raised, sunken, orbit, …) with the hint under it, instead of a dropdown with a hint below it, so you can try them one after another.
  - **Content sits**: two-button switch, on top of the art / under the art's edges.
  - **Strength** slider.
  - **Shape** (collapsed `<details>`): corner radius, frame, edge roughness.
  - **Position and size** (collapsed): left, top, width, height, and kind.
- Empty state (no zones): the starting layouts as four buttons with a one-line description each, plus Add zone.

### Art tab

Style and colours as small swatches with names (radio groups), detail, reach, fill the background, New pattern.

### Use it tab

Canvas size first (it's chosen by your stream's resolution, so it belongs with output), then Download back / front, the two links with Copy, and the steps. **Start from a layout** sits at the bottom, behind the existing replace-confirm dialog, since it's the one destructive action that undo would make easy to miss.

## Previewing

- **Edit** (default): outlines, names, grips, striped stand-ins for content, zone toolbar.
- **Preview**: no outlines, grips or toolbar; zones stop taking pointer input. Stand-ins become flat dark "video" blocks with the zone's name small in a corner, so you judge the layering against something like real content. A **Show** switch in the stage toolbar appears in this mode: **Scene** (back + stand-ins + front), **Back layer**, **Front layer**, the last two on the checkerboard. This is the one place the front layer is ever explained by looking at it.
- **Full screen** (button, or F): the stage alone, in Preview mode, fills the screen through the Fullscreen API, drawn at full resolution (scale 1, not the editing preview's 0.75). The Show switch and an Exit button sit in a slim bar that fades after 2 s without pointer movement. Esc exits. Where the Fullscreen API is missing (iPhone Safari), it's a fixed full-viewport layer instead.
- **Peek**: holding Space in Edit mode shows Preview until released (as design tools do with their hand and preview keys).

## Deleting, and undo

- Three ways to delete, all one step: ✕ in the zone toolbar, ✕ in the zone's list row, Delete or Backspace with a zone focused on the stage.
- After deleting: "camera removed" toast with an **Undo** button (5 s), and focus moves to the next zone (on the stage when you deleted from the stage, in the list when you deleted from the list), or to Add zone when none are left.
- **Undo history** (this visit only, 50 steps, like sign document): every committed change (drag release, slider release, dropdown, add, delete, duplicate, new pattern, canvas size, starting layout). Ctrl/⌘+Z and Ctrl/⌘+Shift+Z, plus the stage toolbar buttons. Needs `toast()` in `shared/toast.js` to accept an optional action button; sign document can use it too.
- **Duplicate** (⧉, or D): copies the zone 20 px down and right, selected.

## Keyboard

On a focused zone: arrows move 10 px, Shift + arrows resize (as now), Alt + arrows move 1 px, Delete removes, D duplicates, Enter opens the Zones tab on its first control, Esc deselects. Anywhere in the editor: P toggles Edit / Preview, F full screen, Space held peeks, Ctrl/⌘+Z undo. Keys are listed in a "Keys" note in the Zones tab and in the stage's description.

## Phones (under 720 px): app layout

`initPage({ app: true })`, no page scroll:

```
┌────────────────────────────┐
│ stream overlay · 3 zones ☰ │  state
├────────────────────────────┤
│ ┌────────────────────────┐ │
│ │       stage (16:9)     │ │  the stage, full width
│ └────────────────────────┘ │
│ raised ▾ │ under │ ⧉ │ ✕   │  zone toolbar, docked
├────────────────────────────┤
│                            │
│  open tab's controls       │  scrolls inside its own area
│                            │
├────────────────────────────┤
│ Zones  Art  Preview  Use ⋯ │  tool row, icon + caption
└────────────────────────────┘
```

- The stage is too small for a floating toolbar, so on phones the **zone toolbar docks directly under the stage**, the same buttons in the same order.
- **Tool row** at the bottom (as sign document): Zones, Art, Preview, Use it, More. Zones / Art / Use it open their controls in the area between stage and tool row, which scrolls on its own; tapping the open one again closes it, giving the stage the room. Preview toggles the mode; a long press (or the More sheet) goes full screen.
- **More** is the options sheet: canvas size, start from a layout, keys, and the footer's text and source link.
- Turning the phone sideways shows the stage full height with the tool row on the right edge.

## Unchanged

`design.js`, the link format, `view.html`, the renderer and worker, the art itself, storage keys. Strings are added (tabs, modes, toolbar labels, undo), and "Show zones", "stageHelp" and "zone.addKind" go.

## Open questions

1. Should Preview with stand-ins be the default when opening a saved design, so the first thing you see is the result?
2. Effect as a button grid costs height; keep the dropdown on phones?
3. Small thumbnails for effects and styles would help choosing, but each is an image against the 20 KB-per-image budget. Draw them live with the renderer at tiny size instead?
