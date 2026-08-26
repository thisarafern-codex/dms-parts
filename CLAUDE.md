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
