#!/usr/bin/env python3
"""Generate the app's seed data from the DMS Invoicing database.

Reads ../DMS invoicing/app/data/dms.db STRICTLY READ-ONLY (sqlite3 URI
mode=ro) and writes two files:

  seed/models.json  brands, machine models, scaffolded service kits.
                    No personal data — safe to commit.
  seed/owners.json  clients and machine serials, for the (currently hidden)
                    browse-by-client mode. GITIGNORED — real business data.

Safe to re-run: it derives everything fresh from dms.db and never writes to it.
The app merges a newer seed by model key, so re-seeding picks up new machines
without touching part numbers dad has typed in.

    python3 tools/build_seed.py [--dry-run] [--db PATH]
"""

import argparse
import collections
import datetime
import hashlib
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_rules as mr

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.abspath(os.path.join(
    HERE, "..", "DMS invoicing", "app", "data", "dms.db"))


def open_readonly(path):
    """Open dms.db in a way that cannot modify it.

    mode=ro makes SQLite refuse writes outright; immutable would be faster but
    lies to SQLite if the invoicing app is running, so it is not used.
    """
    if not os.path.exists(path):
        sys.exit("dms.db not found at %s" % path)
    conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def digest(path):
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read()).hexdigest()


def build(conn):
    # --- fold every machines.model onto a clean brand + model -------------
    models = {}
    for row in conn.execute("SELECT model FROM machines"):
        brand, display, key, hidden, reason = mr.clean_model(row["model"])
        if not key:
            continue
        entry = models.setdefault(key, {
            "key": key, "brand": brand, "display": display,
            "aliases": set(), "machine_count": 0, "invoice_count": 0,
            "hidden": hidden, "hidden_reason": reason,
        })
        entry["machine_count"] += 1
        entry["aliases"].add(mr.tidy_model(row["model"]))
        # Prefer the tidiest spelling as the display name.
        if len(display) < len(entry["display"]):
            entry["display"] = display

    # --- how often each model is actually invoiced (drives sort order) ----
    # invoices.machine_model is the same free text, so fold it the same way.
    usage_alias = {}          # old model_part_usage key -> folded key
    for row in conn.execute(
            "SELECT machine_model, COUNT(*) n FROM invoices "
            "WHERE machine_model IS NOT NULL GROUP BY machine_model"):
        raw = row["machine_model"]
        _, _, key, hidden, _ = mr.clean_model(raw)
        usage_alias[mr.model_key(raw)] = key
        if key in models and not hidden:
            models[key]["invoice_count"] += row["n"]

    # --- scaffold one kit per model from the historical filter usage ------
    # model_part_usage is keyed by the invoicing app's model_key(), which does
    # not strip the brand word, so 'U554' and 'U554KUBOTA' are separate rows
    # there. Map them through the same folding before merging.
    slots = collections.defaultdict(lambda: collections.defaultdict(int))
    slot_last = collections.defaultdict(dict)
    for row in conn.execute(
            "SELECT u.machine_model, u.use_count, u.last_used_at, c.description "
            "FROM model_part_usage u JOIN catalog_items c ON c.id = u.catalog_item_id "
            "WHERE c.item_group = 'Filters'"):
        slot = mr.filter_slot(row["description"])
        if not slot:
            continue
        key = usage_alias.get(row["machine_model"])
        if key is None:
            _, _, key, _, _ = mr.clean_model(row["machine_model"])
        if key not in models:
            continue
        slots[key][slot] += row["use_count"] or 0
        prev = slot_last[key].get(slot) or ""
        if (row["last_used_at"] or "") > prev:
            slot_last[key][slot] = row["last_used_at"]

    out_models = []
    for key, entry in models.items():
        lines = []
        for slot, count in slots.get(key, {}).items():
            lines.append({
                "slot": slot, "qty": 1, "use_count": count,
                "last_used_at": slot_last[key].get(slot),
            })
        lines.sort(key=lambda l: (mr.slot_sort(l["slot"]), l["slot"]))
        entry = dict(entry)
        entry["aliases"] = sorted(a for a in entry["aliases"] if a)
        # Interval is deliberately unset: the invoice history never recorded
        # which service interval a part was fitted at, and inventing '500 hour'
        # would be a guess dressed up as data. The app offers a one-tap split
        # into interval kits once dad tells it what the intervals are.
        entry["kits"] = [{
            "label": "Standard service", "interval_hours": None,
            "sort": 0, "lines": lines,
        }]
        out_models.append(entry)

    out_models.sort(key=lambda m: (m["hidden"], -m["invoice_count"],
                                   -m["machine_count"], m["display"].lower()))

    # --- brands, ordered by how much work each represents -----------------
    counts = collections.Counter()
    for m in out_models:
        if not m["hidden"]:
            counts[m["brand"]] += m["invoice_count"] + m["machine_count"]
    brands = []
    ordered = sorted(counts.items(), key=lambda kv: (kv[0] == mr.UNASSIGNED, -kv[1], kv[0]))
    for i, (name, _) in enumerate(ordered):
        brands.append({"name": name, "sort": i})

    return {
        "seed_version": datetime.datetime.now().strftime("%Y%m%d%H%M%S"),
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "brands": brands,
        "models": out_models,
    }


def build_owners(conn):
    clients = [dict(company=r["company"], contact_name=r["contact_name"],
                    archived=r["archived"], id=r["id"])
               for r in conn.execute(
                   "SELECT id, company, contact_name, archived FROM clients")]
    machines = []
    for r in conn.execute(
            "SELECT id, client_id, model, serial, notes, archived FROM machines"):
        _, _, key, hidden, _ = mr.clean_model(r["model"])
        machines.append({"id": r["id"], "client_id": r["client_id"],
                         "model_key": key, "raw_model": r["model"],
                         "serial": r["serial"], "notes": r["notes"],
                         "archived": r["archived"], "hidden": hidden})
    return {"clients": clients, "machines": machines}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be written, write nothing")
    args = ap.parse_args()

    # The invoicing app runs SQLite in WAL mode, so -wal/-shm sidecars legitimately
    # exist. What matters is that OUR read leaves them untouched, not that they
    # are absent — so snapshot their state rather than warning on mere existence.
    sidecars = [args.db + s for s in ("-wal", "-journal", "-shm")]
    before_side = {p: (os.path.getmtime(p), os.path.getsize(p))
                   for p in sidecars if os.path.exists(p)}

    before = digest(args.db)
    conn = open_readonly(args.db)
    data = build(conn)
    owners = build_owners(conn)
    conn.close()
    after = digest(args.db)

    visible = [m for m in data["models"] if not m["hidden"]]
    hidden = [m for m in data["models"] if m["hidden"]]
    scaffolded = sum(1 for m in visible if m["kits"][0]["lines"])
    unassigned = [m for m in visible if m["brand"] == mr.UNASSIGNED]

    print("source      : %s" % args.db)
    print("md5 before  : %s" % before)
    print("md5 after   : %s  %s" % (after, "UNCHANGED" if before == after else "*** MODIFIED ***"))
    after_side = {p: (os.path.getmtime(p), os.path.getsize(p))
                  for p in sidecars if os.path.exists(p)}
    if after_side == before_side:
        print("sidecars    : %d WAL file(s) untouched by this read"
              % len(before_side))
    else:
        for p in set(before_side) | set(after_side):
            if before_side.get(p) != after_side.get(p):
                print("WARNING: %s changed during the read" % p)
    print()
    print("brands      : %d" % len(data["brands"]))
    print("models      : %d visible, %d hidden" % (len(visible), len(hidden)))
    print("with kits   : %d of %d visible models have scaffolded filter slots"
          % (scaffolded, len(visible)))
    print("unassigned  : %d (%s)" % (len(unassigned),
                                     ", ".join(m["display"] for m in unassigned) or "none"))
    print("clients     : %d   machines: %d" % (len(owners["clients"]), len(owners["machines"])))

    if before != after:
        sys.exit("ABORT: the source database changed during the read.")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    seed_dir = os.path.join(HERE, "seed")
    if not os.path.isdir(seed_dir):
        os.makedirs(seed_dir)
    for name, payload in (("models.json", data), ("owners.json", owners)):
        path = os.path.join(seed_dir, name)
        with open(path, "w") as fh:
            json.dump(payload, fh, indent=1, sort_keys=True)
        print("wrote %-22s %6.1f KB" % (
            os.path.relpath(path, HERE), os.path.getsize(path) / 1024.0))


if __name__ == "__main__":
    main()
