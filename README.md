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

- **Find a machine** — tap the brand, then the machine. The search box also
  matches old spellings, so typing `u 55` finds `U55-4`.
- **See the filters** — each machine has service kits; a kit lists every filter
  position with its part numbers. Tap a number to copy it.
- **Add a number** — tap *Add part number* on any position. Mark it genuine or
  aftermarket. Both can sit on the same position: that *is* the cross-reference.
- **Add anything from anywhere** — the **+** in the header, on every screen,
  adds a new machine, a new brand, a new service kit, or a new part number
  without having to first find your way to the right page.
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

The 115 machines were taken from four years of invoices in the DMS Invoicing
app — so the list is the machines actually serviced, not a catalogue of every
digger ever made. The filter *positions* on each kit come from what was
genuinely fitted to that model over those years, which is why most kits arrive
with the right rows already there, waiting for numbers.

That invoicing database is only ever **read**, once, on a computer — never by
this app, never on the phone, never written to.

Names get typed differently over the years, so `U55-4`, `U 55-4` and
`U55-4 Kubota` are folded into one machine. If something looks wrong — a machine
under the wrong brand, or two entries for one digger — Menu → **Tidy up** fixes
it, and it only ever changes this app's own copy.

## For developers

See [CLAUDE.md](CLAUDE.md) for architecture, the read-only database rule, and
the things that will bite you.

```bash
python3 tools/serve.py 8777        # dev server
python3 tools/build_seed.py        # regenerate seed from the invoicing database
```
