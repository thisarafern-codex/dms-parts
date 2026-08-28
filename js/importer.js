/* Bulk-write part numbers transcribed from dad's own notes/invoices/catalogs
   into IndexedDB. Additive only, and deliberately conservative: it reuses
   the exact write path a hand-typed save already goes through (link() then
   cascadeForward(), same shape as UI2.saveParticular in js/ui.js) so an
   imported number behaves identically to one dad typed himself — same
   forward cascade across 250/500/750/1000, same dedupe-by-number_key.

   Staging row shape: {
     model_key,            // must exact-match an existing models.key, unless create_new
     create_new,           // optional — only set for a genuinely new machine
     brand, model_display, // used only when create_new
     slot,                 // must exact-match (or intentionally add) a kit_lines.slot string
     kind,                 // 'oem' | 'aftermarket'
     aftermarket_brand,    // required when kind === 'aftermarket'
     part_number, price, supplier, notes,
     source_doc, source_kind  // 'oem_catalog' | 'note' — drives the unverified flag
   }

   A genuine (kind: 'oem') number is never overwritten or duplicated — if the
   slot already holds a DIFFERENT genuine number, the row is reported as a
   conflict and skipped rather than guessed at. Aftermarket numbers always
   just add, since several aftermarket options piling up per slot is the
   normal case elsewhere in this app. Reusing an existing parts row (found by
   number_key) never touches its existing fields — only a brand-new parts
   row gets price/notes/unverified populated from the staging row, so a
   bulk import can never silently overwrite something dad typed by hand. */
(function (global) {
  'use strict';

  var SERVICE_INTERVALS = [250, 500, 750, 1000];

  function partKey(number) {
    return String(number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function findByName(store, name) {
    var key = String(name || '').trim().toLowerCase();
    if (!key) return Promise.resolve(null);
    return DB.all(store).then(function (rows) {
      return rows.filter(function (r) { return r.name.toLowerCase() === key; })[0] || null;
    });
  }

  function ensureNamed(store, name) {
    return findByName(store, name).then(function (existing) {
      if (existing) return existing.name;
      return DB.put(store, { name: name }).then(function () { return name; });
    });
  }

  function link(lineId, partId) {
    return DB.byIndex('kit_line_parts', 'kit_line_id', lineId).then(function (links) {
      if (links.some(function (l) { return l.part_id === partId; })) return false;
      return DB.put('kit_line_parts', { kit_line_id: lineId, part_id: partId, sort: links.length })
        .then(function () { return true; });
    });
  }

  /* Same forward-only walk as ui.js's cascadeForward — only ever touches a
     kit that already has a kit_line with the same slot name. */
  function cascadeForward(lineId, partId) {
    return DB.get('kit_lines', lineId).then(function (line) {
      return DB.get('kits', line.kit_id).then(function (kit) {
        if (!kit || !kit.interval_hours) return [];
        return DB.byIndex('kits', 'model_id', kit.model_id).then(function (siblingKits) {
          var later = siblingKits.filter(function (k) {
            return k.interval_hours && k.interval_hours > kit.interval_hours;
          }).sort(function (a, b) { return a.interval_hours - b.interval_hours; });
          var addedTo = [];
          return later.reduce(function (chain, laterKit) {
            return chain.then(function () {
              return DB.byIndex('kit_lines', 'kit_id', laterKit.id).then(function (lines) {
                var match = lines.filter(function (l) { return l.slot === line.slot; })[0];
                if (!match) return null;
                return link(match.id, partId).then(function (added) {
                  if (added) addedTo.push(laterKit.label);
                });
              });
            });
          }, Promise.resolve()).then(function () { return addedTo; });
        });
      });
    });
  }

  function resolveModel(row, write) {
    return DB.oneByIndex('models', 'key', row.model_key).then(function (existing) {
      if (existing) return { model: existing, created: false };
      if (!row.create_new) return { model: null, created: false };
      if (!write) {
        return { model: { id: null, key: row.model_key, brand: row.brand,
                           display: row.model_display }, created: true };
      }
      return ensureNamed('brands', row.brand).then(function (brandName) {
        return DB.put('models', {
          key: row.model_key, brand: brandName, display: row.model_display,
          aliases: [row.model_display], machine_count: 0, invoice_count: 0,
          hidden: 0, hidden_reason: null, brand_locked: 1, source: 'manual'
        });
      }).then(function (modelId) {
        return SERVICE_INTERVALS.reduce(function (chain, hours, i) {
          return chain.then(function () {
            return DB.put('kits', { model_id: modelId, label: hours + ' hours',
                                    interval_hours: hours, sort: i });
          });
        }, Promise.resolve()).then(function () { return DB.get('models', modelId); });
      }).then(function (m) { return { model: m, created: true }; });
    });
  }

  /* Targets the 250h kit — the earliest interval — and leans on
     cascadeForward to reach 500/750/1000, same as a hand-typed save would. */
  function resolveKitLine(model, slot, write) {
    return DB.byIndex('kits', 'model_id', model.id).then(function (kits) {
      var kit250 = kits.filter(function (k) { return k.interval_hours === 250; })[0] || kits[0];
      if (!kit250) throw new Error('No kits found for ' + model.display);
      return DB.byIndex('kit_lines', 'kit_id', kit250.id).then(function (lines) {
        var match = lines.filter(function (l) { return l.slot === slot; })[0];
        if (match) return { line: match, created: false };
        if (!write) return { line: { id: null, kit_id: kit250.id, slot: slot }, created: true };
        return DB.put('kit_lines', { kit_id: kit250.id, slot: slot, qty: 1,
                                     sort: lines.length, notes: null })
          .then(function (id) { return DB.get('kit_lines', id); })
          .then(function (line) { return { line: line, created: true }; });
      });
    });
  }

  function resolvePart(row, model, write) {
    var key = partKey(row.part_number);
    return DB.oneByIndex('parts', 'number_key', key).then(function (existing) {
      if (existing) return { part: existing, created: false };
      if (!write) {
        return { part: { id: null, number_display: row.part_number, number_key: key,
                          kind: row.kind }, created: true };
      }
      var mfrPromise = row.kind === 'oem'
        ? Promise.resolve(model.brand)
        : ensureNamed('aftermarket_brands', row.aftermarket_brand || 'Unknown');
      return mfrPromise.then(function (manufacturer) {
        var now = new Date().toISOString();
        var fields = {
          number_display: row.part_number, number_key: key, kind: row.kind,
          manufacturer: manufacturer, supplier: row.supplier || '',
          price_cents: (typeof row.price === 'number') ? Math.round(row.price * 100) : null,
          notes: row.notes || (row.source_doc ? ('Imported from ' + row.source_doc) : ''),
          unverified: row.source_kind === 'oem_catalog' ? 0 : 1,
          created_at: now, updated_at: now
        };
        return DB.put('parts', fields).then(function (id) {
          fields.id = id;
          return { part: fields, created: true };
        });
      });
    });
  }

  function processRow(row, write) {
    if (!row.model_key) return Promise.resolve({ row: row, status: 'bad_row' });
    if (!row.slot) return Promise.resolve({ row: row, status: 'bad_row' });
    var key = partKey(row.part_number);
    if (!key) return Promise.resolve({ row: row, status: 'bad_row' });

    return resolveModel(row, write).then(function (mr) {
      if (!mr.model) return { row: row, status: 'unmatched_model' };
      return resolveKitLine(mr.model, row.slot, write).then(function (lr) {
        // A slot that would only be created on commit has no links yet.
        var linksP = lr.line.id
          ? DB.byIndex('kit_line_parts', 'kit_line_id', lr.line.id)
          : Promise.resolve([]);
        return linksP.then(function (existingLinks) {
          return Promise.all(existingLinks.map(function (l) { return DB.get('parts', l.part_id); }))
            .then(function (linkedParts) {
              var base = { row: row, model: mr.model.display,
                           model_created: mr.created, slot_created: lr.created };
              if (row.kind === 'oem') {
                var existingGenuine = linkedParts.filter(function (p) {
                  return p && p.kind === 'oem';
                })[0];
                if (existingGenuine && existingGenuine.number_key !== key) {
                  base.status = 'genuine_conflict';
                  base.existing = existingGenuine.number_display;
                  return base;
                }
              }
              var alreadyLinked = linkedParts.some(function (p) { return p && p.number_key === key; });
              if (alreadyLinked) { base.status = 'already_linked'; return base; }

              return resolvePart(row, mr.model, write).then(function (pr) {
                if (!write) {
                  base.status = pr.created ? 'would_add_new_part' : 'would_link_existing_part';
                  return base;
                }
                return link(lr.line.id, pr.part.id).then(function () {
                  return cascadeForward(lr.line.id, pr.part.id);
                }).then(function (cascadedTo) {
                  base.status = 'added';
                  base.cascaded_to = cascadedTo;
                  return base;
                });
              });
            });
        });
      });
    });
  }

  /* Sequential on purpose (same pattern as seed.js/ui.js's chained reduces) —
     an occasional-use, small-batch screen, not a hot path, and it keeps each
     row's IndexedDB reads/writes easy to reason about. */
  function run(rows, opts) {
    var write = !!(opts && opts.commit);
    var results = [];
    return rows.reduce(function (chain, row) {
      return chain.then(function () {
        return processRow(row, write).then(function (r) { results.push(r); });
      });
    }, Promise.resolve()).then(function () {
      var summary = { total: results.length };
      results.forEach(function (r) {
        summary[r.status] = (summary[r.status] || 0) + 1;
        if (r.model_created) summary.models_created = (summary.models_created || 0) + 1;
        if (r.slot_created) summary.slots_created = (summary.slots_created || 0) + 1;
      });
      return { summary: summary, results: results };
    });
  }

  global.Importer = { run: run, partKey: partKey };
})(window);
