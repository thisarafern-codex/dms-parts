# DMS Parts

Filter part numbers for every digger DMS services — on the phone, at the parts
counter, with or without signal.

**brand → machine → service kit → part numbers.** Genuine and aftermarket
together, big enough to read in a badly-lit shed.

---

## Getting it on the phone

1. Open the site in Chrome on the Android phone.
2. Menu (⋮) → **Add to Home screen**.
3. Open it from the home screen from then on. It works with no signal.

## Using it

- **Find a brand** — the search box on the home screen filters the brand
  tiles as you type; it doesn't look inside machines or part numbers, just
  brand names. Brands and machines are both listed alphabetically throughout.
- **Find a machine** — tap the brand, then the machine. The search box also
  matches old spellings, so typing `u 55` finds `U55-4`.
- **See the filters** — each machine has service kits; a kit lists every filter
  position with its part numbers. Tap a number to copy it.
- **Add a number** — tap *Add part number* on any position. Mark it genuine or
  aftermarket. Both can sit on the same position: that *is* the cross-reference.
- **Add anything from anywhere** — the **+** in the header, on every screen,
  adds a new machine, a new brand, or a new part number without having to
  first find your way to the right page. Every machine comes with four fixed
  service kits — 250, 500, 750 and 1000 hours — so there's nothing to set up,
  just numbers to fill in.
- **Got a number, need the machine?** — *Search a part number* on the home
  screen works backwards: type the number in your hand, see every machine that
  takes it.
- **Text too small?** — Menu → **Text size**. It stacks on top of the phone's
  own text size setting.

## Back it up

**The phone holds the only copy of every part number you type.** Lose the phone
and you lose them all.

Menu → **Backup** → *Save a backup file*, then put it in Drive or email it to
yourself. Do this after any decent session of adding numbers. The same screen
restores from a backup file.

## Where the machine list came from

The 115 machines are the ones DMS has actually serviced, not a catalogue of
every digger ever made, and the filter *positions* on each kit come from what
has genuinely gone into that model before — which is why most kits arrive with
the right rows already there, waiting for numbers.

Names get typed differently over the years, so `U55-4`, `U 55-4` and
`U55-4 Kubota` are folded into one machine. If something looks wrong — a machine
under the wrong brand, or two entries for one digger — Menu → **Tidy up** fixes
it (rename, move brand, merge, hide, or delete outright for a genuine
duplicate), and it only ever changes this app's own copy.

## For developers

See [CLAUDE.md](CLAUDE.md) for architecture, the read-only database rule, and
the things that will bite you.

```bash
python3 tools/serve.py 8777        # dev server
python3 tools/build_seed.py        # regenerate seed/models.json
```
