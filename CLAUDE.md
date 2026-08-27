# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

**DMS Parts** — an offline-first web app that answers one question at a parts
shop counter: *which filters does this digger take, and what are the part
numbers?* Built for the owner of DMS (Digger Mobile Service), used on an Android
phone, often on mobile data and sometimes with no signal at all.

The flow is deliberately three taps: **brand → machine model → service kit →
part numbers**, genuine and aftermarket side by side.

It is a sibling to, but independent of, the **DMS Invoicing** app at
`../DMS invoicing/app` (Flask + SQLite + ReportLab). This app shares none of its
runtime — it borrows its *data* once, at build time.

## Architecture

Static PWA. **No Node, no build step, no framework** — the same philosophy as
the invoicing app, but without Flask, because the field app has to run with no
server at all.

```
index.html + css/ + js/        vanilla SPA, hash routing
sw.js                          precaches the shell; app works at zero bars
IndexedDB (js/db.js)           source of truth for everything typed in
   ↑ seeded once from
seed/models.json               generated offline by tools/build_seed.py
```

There is **no server in the field**. Reads and writes both work offline; the
phone holds the live copy of the part numbers.

## Commands

Dev server (stdlib only, no venv needed):
```
python3 tools/serve.py 8777
```

Regenerate the seed from the invoicing app's database:
```
python3 tools/build_seed.py --dry-run     # report only, writes nothing
python3 tools/build_seed.py               # writes seed/models.json + seed/owners.json
```

Regenerate the app icons:
```
python3 tools/make_icons.py
```

There is no test suite, no linter and no package manifest — this is intentionally
not an installable package.

## Verify every change yourself, in the browser

Don't call a UI or behaviour change done from reading the code — start
`tools/serve.py`, open it in the browser tool, and actually drive it: click
through the screen, check the console, confirm the thing you changed. This
app has bitten us before on things that only show up live (a merge bug that
only appeared with real data, a layout that only broke at the largest text
size, a service-worker quirk invisible in a code read). Don't ask the user to
check it and report back — check it yourself, then tell them what you saw.

## The database rule

`../DMS invoicing/app/data/dms.db` is **live production data** — real clients,
real invoices. In this repo it is:

- opened **only** by `tools/build_seed.py`, **only** as
  `sqlite3.connect("file:...?mode=ro", uri=True)`;
- never written to, never `ATTACH`ed, never opened by the app itself;
- never copied into this repo.

`build_seed.py` md5s the database before and after every run and aborts if it
changed. It also snapshots the `-wal`/`-shm` sidecars — those legitimately exist
because the invoicing app runs SQLite in WAL mode, so the check is that *our*
read leaves them untouched, not that they are absent.

**`seed/owners.json` is gitignored.** It holds real client names and machine
serials. `seed/models.json` holds only machine models and is safe to commit.
This matters more than usual because the deploy target is GitHub Pages: anything
committed becomes **public**. Client data must never be in a commit.

## What the seed can and cannot provide

`dms.db` has **almost no part numbers** — of 234 `catalog_items`, exactly one
contains a real one. The filter rows are generic descriptions
(`Engine oil filter`, `Hitachi Air Filter Inner`). So the part numbers, the
thing this app exists to show, are entered by hand and accumulate over time.

What the seed *does* give, and why each matters:

1. **The model list** — 115 visible models, the machines he actually services,
   not a generic catalogue of every digger built.
2. **Brand** — inferred, because only about a third of model strings name it.
3. **Filter slots per model** — from `model_part_usage`, so each of a
   model's four kits arrives pre-scaffolded with the right empty positions
   (83 of 115 models) instead of presenting a blank page 115 times.

## Model folding — the part that is easy to get wrong

`tools/model_rules.py` holds three layers, and **all three are needed**:

- **`model_key()`** (copied from the invoicing app's `server/models.py:99`, kept
  identical on purpose) strips non-alphanumerics and uppercases, folding
  `U55-4` / `U 55-4` / `U 55- 4` / `U55- 4` into one.
- **Brand-word stripping** (`split_brand`) is the layer `model_key` alone
  misses: the brand is sometimes glued onto the model, so `SK140` vs
  `Kobelco SK140`, `ZX110` vs `Hitachi ZX110` vs `ZX110 Hitachi`, `DX225LC` vs
  `Doosan DX225LC` would otherwise be separate machines. Pulling the brand out
  *as brand* merges ~18 extra pairs and is what makes brand-first navigation
  work at all.
- **Lead-in stripping** (`clean_model`) recovers models the old Excel importer
  mangled: `Invoice for U55-4`, `Model - CAT 302`, `Fixing ZD1221` all become
  real machines again. Only 2 rows are genuinely unrecoverable prose and they
  are marked `hidden`, never deleted.

Net effect: 152 raw spellings → 115 real machines. `U55-4` alone absorbs 7
spellings and 117 invoices.

Wrong brand guesses are **expected and cheap** — the Tidy-up screen reassigns
them, and setting a brand by hand sets `brand_locked` so a later re-seed won't
overwrite the correction.

## A part added at one interval cascades forward, never back

`cascadeForward()` in `js/ui.js`: dad's rule is that a 500-hour service
already includes everything a 250-hour one does, so a part confirmed at 250
is needed at every later interval too — saving it at 250 auto-adds it to
the *same slot* in 500/750/1000. Saving at 500 only reaches 750/1000. Saving
at 1000 reaches nothing; there's nothing later to cascade into. It walks
forward from wherever the kit being edited sits, matched purely by
`interval_hours`, never backward.

It only touches a kit that already has a `kit_line` with the same `slot`
name — it does not create new filter positions in kits that don't have that
slot, since that would be a bigger structural change than "copy the part
number" and wasn't asked for. Reuses `link()`, so cascading is idempotent —
running twice never double-links. Wired into both `saveParticular` (typing a
new number) and the `link-existing` action (reusing a saved one), since both
are "a part is now attached to this line" from dad's point of view.

## No placeholder hints — a real value or nothing

Every `placeholder="e.g. …"` is gone. Dad's eyesight made the greyed-out
example text easy to mistake for an already-filled value. Labels above each
field still say what it's for; placeholders were only ever the *example*,
not the explanation, so removing them costs nothing. Numeric fields with a
unit (price, oil litres) get a persistent `$`/`L` tag instead via
`.unit-input` in `css/app.css` — unlike a placeholder it doesn't disappear
the moment he starts typing, which is the point.

## The part-number input shrinks to fit, never wraps or overflows

`fitPartNumberFont()` in `js/ui.js`: the box's own CSS font-size is cached
once (`dataset.baseSize`) the first time it's needed, then on every
keystroke the font resets to that size and steps down 1px at a time while
`scrollWidth > clientWidth`, floored at 15px so it never gets illegibly
small. Deleting characters lets it grow back, because the cached base size
is the ceiling it always resets to, not a one-way ratchet. This is the
input-side counterpart to `.part .num`'s `min(2rem, 8.5vw)` — that one is
CSS-only because it's read-only text of a known final length; a live input
needs JS because the length changes as he types.

## Reuse search is scoped to the machine's own brand

The "reuse a number you already have" list on the add-part form used to
search every part ever saved. `partsUsedByBrand()` walks
models → kits → kit_lines → kit_line_parts to build the set of part IDs
already used on *some other machine of the same brand*, and the reuse list
is filtered down to that set before the search box ever runs. A Sakura
filter already used on another Kubota is a realistic reuse; one only ever
used on a Hitachi essentially never is, and showing it just buries the
numbers he actually wants. If the filtered set is empty, the whole "reuse"
section doesn't render at all — no point showing a search box with nothing
to search.

## Oil litres — a fixed field on the model, not a kit thing

`OIL_FIELDS` in `js/ui.js` (`oil_engine`/`oil_hydraulic`/`oil_gear`) lives
directly on the `models` record, since how much oil a machine takes doesn't
change per service interval the way filter part numbers do. Free text, not
a parsed number — nothing does arithmetic on it the way price does, so
"5.5", "~5" or a note are all fine. No schema change needed to add it (new
fields on an existing store, not a new store), unlike aftermarket brands
below.

"Copy from another machine" here follows the same rule as kit copying: it
only fills fields that are currently empty, never overwrites one he's
already typed in. Verified directly — filled Engine oil on one machine,
copied from a source with a *different* engine value, confirmed the
existing value survived while the two empty fields picked up the source's.

## No part-number search — removed at dad's request

He said flat out he'd never use it, so the reverse lookup (type a number,
see every machine that takes it) is gone entirely — `#/search`,
`screenSearch`, `whereUsed`, the bottom-tab-bar Search button, the Menu row,
all deleted rather than just hidden. The bottom tab bar is two buttons now
(Home, Add), not three. If this ever comes back, it's not a revert — the
data model never needed it to exist in the first place, since a `parts`
row's genuine/aftermarket siblings already do the equivalent job one slot at
a time via `kit_line_parts`.

## Kit → category list → one filter position per page

`screenKit` used to render every filter position's full detail (all its
part numbers, add button, everything) on one long page. It's a plain list of
positions now — "Engine oil filter", "Fuel filter", each just a row with a
count — and tapping one goes to `#/slot/<lineId>` (`screenSlot`), which owns
that position's part numbers on their own page, with a filter box once
there are more than four (`partsListHtml`/`partRowHtml` are the shared
rendering, used only by `screenSlot` now). Reflects that dad expects several
aftermarket options to pile up per position over time, not just one.

`del-slot` had to change because of this: it used to call `route()` to
re-render wherever you already were, which worked when that was the kit
page. Now the page you're ON when you delete a position is that position's
own detail page, which no longer exists afterward — so it explicitly
navigates to `#/kit/<kitId>` instead. `unlink` (removing one part from a
position, not the position itself) is untouched — the position still
exists afterward, so `route()` re-rendering `screenSlot` in place is correct.

## Genuine brand is derived, never typed; aftermarket brand is picked, not typed

A genuine part's brand was never really a free choice — it's always
whatever machine the kit belongs to. `resolveManufacturer` in `js/ui.js`
enforces that at save time (fetches line → kit → model fresh, ignores
whatever might be sitting in a form field), and the genuine side of the part
form just shows it as read-only text, not an input.

Aftermarket is the opposite problem: dad's expecting to accumulate several
brands (Sakura, Donaldson, HIFI to start) across many parts, so it's a
`<select>` sourced from the new `aftermarket_brands` store, not a free-text
field — picking "+ Add a new brand…" prompts, saves it via
`ensureAftermarketBrand` (same case-insensitive-reuse shape as `ensureBrand`
for machine brands, just a separate store — don't conflate the two), and
from then on it's available on *every* part's form, not just the one being
added. `ensureDefaultAftermarketBrands()` seeds the three starting names on
first install; it runs in the app's init sequence directly (not gated behind
`Seed.ensure()`'s version check), because it has nothing to do with the
machine-data seed pipeline.

Editing an old part whose brand isn't in that list (predates the picker,
typo, whatever) doesn't lose it or silently rewrite it — `screenPart`
injects it as a selectable option for that one edit without persisting it to
the shared list, so it stays visible and correct without polluting the
picker for every other part until dad deliberately keeps it.

This added a new object store (`aftermarket_brands`), which meant a schema
version bump (`js/db.js`'s `VERSION`, now 2) — purely additive, the existing
generic upgrade loop creates the new store without touching anything already
there. Also added `db.js`'s `onblocked` handler while touching this: a
version bump silently hangs forever if another tab still has the old version
open, which is exactly what happened testing this locally with several dev
tabs left open from earlier in the session — now it rejects with a
message instead of hanging.

## Every machine has exactly four kits — 250 / 500 / 750 / 1000 hours

Not something dad adds one at a time — `tools/build_seed.py`'s
`SERVICE_INTERVALS` (kept in sync by hand with the identical constant in
`js/ui.js`) generates all four for every model, each carrying the same
scaffolded slot list, since the source data has no way to say which filter
belongs to which interval. `js/ui.js`'s `save-machine` action does the same
for a machine dad adds by hand. There is no "add a kit" or "delete a kit" UI
any more; `kit_lines` (filter positions within a kit) are still freely
added/removed, just not the four kits themselves.

This is also why `mergeModels` and `do-copy` (Copy from another machine) both
match kits by `interval_hours` rather than by array position — a 500-hour kit
must only ever fold in from another machine's 500-hour kit, never its 250.

## Brand tiles: real colours, no real photos

`BRAND_COLORS` in `js/ui.js` holds hand-sourced manufacturer colours (Kubota
orange, Caterpillar yellow, and so on) for the brands we could actually
confirm one for — not a guess for every brand. A brand missing from the map
just keeps the app's plain neutral tile; that's deliberate, not a bug, so
don't "fill in" a colour for the rest without a real source.

Every colour in the map is a **verified 7:1 pair** — a light-mode and a
dark-mode background, each with the higher-contrast of black/white text,
nudged in HSL lightness only as far as needed to clear WCAG AAA. A raw brand
hex (Caterpillar yellow especially) will not clear 7:1 against either black
or white without this adjustment, so don't drop a fresh brand colour straight
into the map — add its sourced hex to `tools/brand_colors.py` and run it;
copy the printed line into `BRAND_COLORS`.

No per-brand imagery on the tile (colour only) — an earlier version added a
generic digger-silhouette icon to every tile, but it was dropped at dad's
request. Don't add manufacturer photos here either: this repo is **public**
(GitHub Pages needs that), so real press/catalogue photography would be a
genuine copyright problem regardless of how few people actually visit the
site. A photo dad or the user personally took of an actual job-site machine
would be fine to add per brand — that's the one path that's actually open,
should it come up again.

## Things that will bite you

**Part numbers must never wrap.** `.part .num` is `white-space: nowrap` with a
viewport-relative size and its own horizontal scroll. `HH164-324` / `30` split
across two lines is exactly how a number gets misread, and a misread number
means the wrong filter. Do not "fix" this by letting it wrap.

**18px is a hard floor for every piece of text**, via `--fs-sm`. His eyesight is
poor and he reads this in a badly-lit shed. Sizes are in `rem` off a `100%` root
so Android's own font-scale setting is respected; the in-app A/A+/A++ control
scales on top of that. Both light and dark palettes clear WCAG AAA (7:1).

**`#tabbar` (Home/Search/Add) is `position: fixed` at the bottom of every
screen**, so `body`'s `padding-bottom` and `#toast`'s `bottom` offset are both
hand-tuned to clear it (plus `env(safe-area-inset-bottom)` for gesture-nav
Android phones) — if the bar's height ever changes, both need updating too, or
a screen's last row / the toast ends up hidden behind it. Highlighting which
tab is "active" is driven by `TAB_ROUTES` in `route()`; kit/part/copy screens
count as Home regardless of whether that browsing started from the brand grid
or partway through the Add flow, matching how a tab bar normally behaves
elsewhere (Home stays lit up on a video reached from Home).

**"Copy from another machine" fills empty positions, it does not just add
missing ones.** Both machines usually carry the same scaffolded slots from
history, so matching only on *missing* slots copies nothing useful — and the
numbers are the entire point. A slot the target lacks is created with its
numbers; a slot it has but hasn't filled gets them; a slot already holding
numbers is left alone. It also only ever copies the matching interval — see
above.

**The "+" in the header is global, on every screen, by design.** It opens
`#/quickadd`, which fans out to add-machine, add-brand, add-kit and add-part
flows. Adding a brand hands straight off to add-machine with the new brand
prefilled (`window.__prefillBrand`), because an empty brand with nothing under
it is a dead end. Adding a kit or a part first asks *which machine* via
`screenPickMachine`, a flat search across every brand (not scoped to "wherever
you started"), since the whole point is not having to navigate there first.
`findBrand`/`ensureBrand` do case-insensitive brand matching so typing
`kubota` against an existing `Kubota` reuses it rather than forking a
look-alike duplicate — the `brands.name` index is unique, so this also avoids
an `IDBConstraintError` on the exact-duplicate case.

**Two part numbers on the same `kit_line` ARE the cross-reference.** There is no
separate equivalence table: sharing a position is what "genuine plus aftermarket
alternative" means, and the reverse lookup through `kit_line_parts` answers
"what else takes this filter".

**`number_key`** (alphanumerics, uppercased) is what makes duplicate detection
work, so `RC461-53962`, `rc461 53962` and `RC46153962` are one part. The unique
index on it means you must **look a part up before inserting** or you get a
`ConstraintError`.

**The re-seed is additive and must stay that way.** By the time it runs, part
numbers hang off those rows. It adds models and slots, refreshes counts, and
never deletes.

**`tools/serve.py` stays on HTTP/1.0 but threaded.** HTTP/1.1 keep-alive on this
stdlib server hung, then reset connections mid-page-load. Dev convenience only —
production is static hosting.

**An update doesn't show up until a full close and reopen — normally.**
`sw.js` serves cache-first and only refreshes each file in the background for
*next* time, so the open right after a push still shows the old version.
Menu → **Check for updates** (`checkForUpdate()` in `js/ui.js`) skips the wait:
it re-fetches the shell files with `cache: 'reload'`, writes them straight
into Cache Storage itself, then reloads. It deliberately does **not** use
`registration.update()` — `sw.js`'s own bytes rarely change between updates
(it's the files it *lists* that change), so that check would almost always
report "nothing to update" even when there genuinely is something. Also why
`reconcileKits` in `js/seed.js` exists: an already-installed phone can be
sitting on months-old *data* structure, not just old code, and a plain
re-seed alone won't retroactively fix that — see the four-kits section above.

## Backups are not optional

The phone's IndexedDB is the **only** copy of every part number he types. A lost
or wiped phone loses the lot. The Backup screen warns loudly when numbers exist
and no backup has ever been made, and export prefers Android's share sheet so
the file can go straight to Drive or email.

## Deployment

GitHub Pages, because service workers and the Android install prompt both need
HTTPS. `seed/owners.json` is gitignored and therefore never deployed — correct,
since the site would be public.

Live at **https://thisarafern-codex.github.io/dms-parts/**, repo
`thisarafern-codex/dms-parts` (public — same GitHub account and fine-grained
PAT pattern as the sibling `dms-invoicing` repo; that token had to have its
repository access expanded to cover this repo too before the first push
worked). Every commit this project has had so far went straight onto `main`
and was live within about a minute — no branch, no PR, deliberate: the user
was testing live with dad in real time, and a review step would have just
been reviewing our own change before approving our own change. That's fine
for this project specifically; don't assume it generalises.

## Where things stand

Everything below is shipped and live, not just committed. Built across
several sessions; dad has the app installed and has been testing it live
throughout, and most of these changes are direct feedback from him using it
for real, relayed by the user.

- Core app: brand → machine → four fixed kits (250/500/750/1000 hours) →
  filter positions → part numbers, genuine/aftermarket side by side. Fully
  offline after first load. A part saved at one interval auto-cascades
  **forward** to later intervals on the same slot (250→500/750/1000,
  500→750/1000, 750→1000, 1000→nothing) — never backward.
- A kit is a plain list of filter positions now, not one long page — tap a
  position ("Engine oil filter") to reach its own page with just that
  position's numbers, a filter box once there are more than a handful, and
  its own add/remove controls.
- Genuine parts never ask for a brand — it's always derived from the
  machine, shown read-only. Aftermarket brand is a picker
  (`aftermarket_brands` store: Sakura/Donaldson/HIFI to start) with
  "+ Add a new brand" that persists app-wide, not just for that one part.
  The "reuse a saved number" search on the add-part form is scoped to
  numbers already used on another machine of the **same brand** only.
- Oil litres (Engine/Hydraulic/Gear, free text) live at the top of every
  machine page, above the kits — same "copy from another machine, fill only
  what's empty" rule as filter numbers.
- No placeholder ("e.g. …") hints anywhere — dad found them easy to mistake
  for real values. Price and oil-litre fields get a persistent `$`/`L` tag
  instead. The part-number input shrinks its font to fit long numbers
  rather than wrapping or overflowing.
- Global add ("+" in the header, and Home/Add in the fixed bottom tab bar —
  Search was removed entirely at dad's request, he said flat out he'd never
  use the reverse part-number lookup) for a new machine, brand, or part
  number. Kits are no longer something dad adds — every machine gets all
  four automatically.
- Delete a machine (Tidy Up list, and the Edit Machine screen) for genuine
  duplicates, alongside the existing hide/merge.
- Brand tiles: real, WebSearch-sourced manufacturer colours for the ~14
  brands we could confirm one for (computed to a verified 7:1 pair for both
  themes via `tools/brand_colors.py`), alphabetical, with a brand-name-only
  search box on the home screen. No icon/photo on the tiles — tried a
  generic digger silhouette, dad asked for it gone; real manufacturer
  photos were ruled out entirely as a copyright risk on a public repo.
  Dad's own job-site photos would still be fine to add later; none
  supplied yet. Manuals/troubleshooting-guide idea was raised and then
  dropped by the user — not built, not pursued.
- Every mention of the invoicing system, and every invoice/machine-count
  display, is gone from the UI — it's all internal bookkeeping now, never
  shown. The underlying data (aliases, sort weighting) still exists and is
  still used, just not displayed.
- Text size: the three Menu tiers were shifted down a notch (was
  100/115/132%, now 88/100/115%) — dad's default felt too big once he was
  actually using it day to day.
- "Check for updates" in the Menu forces an immediate refresh instead of
  waiting on the passive close-reopen-(sometimes-twice) mechanism — this
  landed *after* the fix below, which is why that fix needed its own
  separate re-seed to actually take effect on an already-installed phone.
- Fixed a real bug where a phone that installed before the four-kit change
  never retroactively got the new kits on re-seed (`reconcileKits` in
  `js/seed.js`) — confirmed fixed on dad's actual phone.

**Not done / explicitly deferred:** bulk-importing dad's existing part
numbers from Samsung Notes (Phase 5 in the original plan) — manual one-at-a-
time entry is the path for now, and the cascade-forward behaviour above
makes that less repetitive than it sounds. No confirmation yet that dad has
made an actual backup of anything he's typed in — worth checking next
session, since the amount of hand-typed data is only growing.
