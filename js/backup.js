/* Export / import everything as one JSON file.

   The phone's IndexedDB is the ONLY copy of every part number dad types, so
   this is not a nice-to-have: a lost or wiped phone must not mean lost work. */
(function (global) {
  'use strict';

  var STORES = ['brands', 'models', 'kits', 'kit_lines', 'parts',
                'kit_line_parts', 'clients', 'machines', 'aftermarket_brands', 'meta'];

  function exportAll() {
    return Promise.all(STORES.map(function (s) { return DB.all(s); }))
      .then(function (results) {
        var payload = { format: 'dms-parts-backup', version: 1,
                        exported_at: new Date().toISOString(), data: {} };
        STORES.forEach(function (s, i) { payload.data[s] = results[i]; });
        return payload;
      });
  }

  function filename() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'dms-parts-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  }

  function download() {
    return exportAll().then(function (payload) {
      var text = JSON.stringify(payload, null, 1);
      var blob = new Blob([text], { type: 'application/json' });
      var name = filename();

      // Android's share sheet is the natural place for this — it lets him put
      // the file in Drive or email it to himself. Fall back to a download.
      var file = null;
      try { file = new File([blob], name, { type: 'application/json' }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'DMS Parts backup' })
          .then(function () { return { shared: true, name: name, bytes: text.length }; })
          .catch(function () { return saveBlob(blob, name, text.length); });
      }
      return saveBlob(blob, name, text.length);
    });
  }

  function saveBlob(blob, name, bytes) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return Promise.resolve({ shared: false, name: name, bytes: bytes });
  }

  /* Replaces everything. Confirmed in the UI before it is ever called. */
  function importAll(payload) {
    if (!payload || payload.format !== 'dms-parts-backup') {
      return Promise.reject(new Error('That file is not a DMS Parts backup.'));
    }
    var data = payload.data || {};
    return DB.clear(STORES).then(function () {
      return STORES.reduce(function (chain, s) {
        return chain.then(function () { return DB.bulk(s, data[s] || []); });
      }, Promise.resolve());
    }).then(function () {
      var n = 0;
      STORES.forEach(function (s) { n += (data[s] || []).length; });
      return { rows: n };
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        try { resolve(JSON.parse(fr.result)); }
        catch (e) { reject(new Error('That file is not readable JSON.')); }
      };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  /* Additive merge, for working from two devices (e.g. dad's phone and
     tablet) without either one clobbering the other. Never deletes.

     The hard part: every store's `id` is a local autoincrement, meaningless
     across two independently-seeded IndexedDB databases — the file's
     model_id 5 is not this device's model_id 5. So each store is matched by
     a real-world natural key (models by `key`, parts by `number_key`, kits
     by interval_hours within their model, kit_lines by slot within their
     kit, brands/aftermarket_brands by name), and an id map from the
     incoming id to the local id is built as we go, used to resolve the
     foreign keys in kits/kit_lines/kit_line_parts.

     `clients`/`machines` are intentionally not merged — nothing in the app
     currently writes rows into either store (only `seed/models.json` is
     ever loaded client-side; `seed/owners.json`, the only source of
     clients/machines rows, is never fetched by the browser), so there is
     nothing real to merge and no reliable natural key to merge it by if
     that ever changes. `meta` is also left alone — it's per-device
     bookkeeping (seed version, last backup time), not shared data. */
  function mergeAll(payload) {
    if (!payload || payload.format !== 'dms-parts-backup') {
      return Promise.reject(new Error('That file is not a DMS Parts backup.'));
    }
    var data = payload.data || {};
    var stats = { models_added: 0, kits_added: 0, slots_added: 0,
                  parts_added: 0, parts_updated: 0, links_added: 0 };

    return mergeNamed('brands', data.brands || [])
      .then(function () { return mergeNamed('aftermarket_brands', data.aftermarket_brands || []); })
      .then(function () { return mergeModels(data.models || [], data.kits || [], data.kit_lines || [], stats); })
      .then(function (maps) {
        return mergeParts(data.parts || [], stats).then(function (partIdMap) {
          return mergeLinks(data.kit_line_parts || [], maps.kitLineIdMap, partIdMap, stats);
        });
      })
      .then(function () { return stats; });
  }

  function mergeNamed(store, rows) {
    return DB.all(store).then(function (existing) {
      var byName = {};
      existing.forEach(function (r) { byName[r.name.toLowerCase()] = true; });
      return rows.reduce(function (chain, r) {
        return chain.then(function () {
          var key = String(r.name || '').trim().toLowerCase();
          if (!key || byName[key]) return null;
          byName[key] = true;
          return DB.put(store, { name: r.name });
        });
      }, Promise.resolve());
    });
  }

  function mergeModels(models, kits, kitLines, stats) {
    var kitsByModel = {}, linesByKit = {};
    kits.forEach(function (k) { (kitsByModel[k.model_id] = kitsByModel[k.model_id] || []).push(k); });
    kitLines.forEach(function (l) { (linesByKit[l.kit_id] = linesByKit[l.kit_id] || []).push(l); });

    var modelIdMap = {}, kitIdMap = {}, kitLineIdMap = {};

    return DB.all('models').then(function (existingModels) {
      var byKey = {};
      existingModels.forEach(function (m) { byKey[m.key] = m; });

      return models.reduce(function (chain, m) {
        return chain.then(function () {
          var found = byKey[m.key];
          var modelPromise;
          if (found) {
            var aliasSet = {};
            (found.aliases || []).forEach(function (a) { aliasSet[a] = true; });
            (m.aliases || []).forEach(function (a) { aliasSet[a] = true; });
            found.aliases = Object.keys(aliasSet);
            // A hide sticks either way — there's no per-field timestamp on
            // models to know which device's state is more recent.
            found.hidden = (found.hidden || m.hidden) ? 1 : 0;
            if (!found.brand_locked && m.brand_locked) { found.brand = m.brand; found.brand_locked = 1; }
            found.machine_count = Math.max(found.machine_count || 0, m.machine_count || 0);
            found.invoice_count = Math.max(found.invoice_count || 0, m.invoice_count || 0);
            modelPromise = DB.put('models', found).then(function () {
              modelIdMap[m.id] = found.id;
            });
          } else {
            stats.models_added += 1;
            var row = { key: m.key, brand: m.brand, display: m.display, aliases: m.aliases || [],
                        machine_count: m.machine_count || 0, invoice_count: m.invoice_count || 0,
                        hidden: m.hidden ? 1 : 0, hidden_reason: m.hidden_reason || null,
                        brand_locked: m.brand_locked ? 1 : 0, source: m.source || 'seed' };
            modelPromise = DB.put('models', row).then(function (id) {
              modelIdMap[m.id] = id;
              byKey[m.key] = row;
            });
          }
          return modelPromise.then(function () {
            return mergeKitsForModel(modelIdMap[m.id], kitsByModel[m.id] || [], linesByKit,
                                      kitIdMap, kitLineIdMap, stats);
          });
        });
      }, Promise.resolve()).then(function () {
        return { modelIdMap: modelIdMap, kitIdMap: kitIdMap, kitLineIdMap: kitLineIdMap };
      });
    });
  }

  function mergeKitsForModel(localModelId, incomingKits, linesByKit, kitIdMap, kitLineIdMap, stats) {
    return DB.byIndex('kits', 'model_id', localModelId).then(function (existingKits) {
      var byInterval = {};
      existingKits.forEach(function (k) { byInterval[k.interval_hours] = k; });

      return incomingKits.reduce(function (chain, k) {
        return chain.then(function () {
          var found = byInterval[k.interval_hours];
          var kitPromise;
          if (found) {
            kitIdMap[k.id] = found.id;
            kitPromise = Promise.resolve();
          } else {
            stats.kits_added += 1;
            kitPromise = DB.put('kits', { model_id: localModelId, label: k.label,
                                          interval_hours: k.interval_hours, sort: k.sort || 0 })
              .then(function (id) {
                kitIdMap[k.id] = id;
                byInterval[k.interval_hours] = { id: id };
              });
          }
          return kitPromise.then(function () {
            return mergeLinesForKit(kitIdMap[k.id], linesByKit[k.id] || [], kitLineIdMap, stats);
          });
        });
      }, Promise.resolve());
    });
  }

  function mergeLinesForKit(localKitId, incomingLines, kitLineIdMap, stats) {
    return DB.byIndex('kit_lines', 'kit_id', localKitId).then(function (existingLines) {
      var bySlot = {};
      existingLines.forEach(function (l) { bySlot[l.slot] = l; });

      return incomingLines.reduce(function (chain, l) {
        return chain.then(function () {
          var found = bySlot[l.slot];
          if (found) { kitLineIdMap[l.id] = found.id; return null; }
          stats.slots_added += 1;
          return DB.put('kit_lines', { kit_id: localKitId, slot: l.slot, qty: l.qty || 1,
                                       sort: existingLines.length, notes: l.notes || null })
            .then(function (id) {
              kitLineIdMap[l.id] = id;
              bySlot[l.slot] = { id: id };
              existingLines.push({ id: id, slot: l.slot });
            });
        });
      }, Promise.resolve());
    });
  }

  /* The one store where "newer wins" actually matters — a price or note
     fixed on one device should reach the other, not just get silently
     ignored because a stub already existed locally. Compares `updated_at`;
     never touches the local row's `id` so existing kit_line_parts links
     stay valid. */
  function mergeParts(incomingParts, stats) {
    var partIdMap = {};
    return DB.all('parts').then(function (existing) {
      var byKey = {};
      existing.forEach(function (p) { byKey[p.number_key] = p; });

      return incomingParts.reduce(function (chain, p) {
        return chain.then(function () {
          var found = byKey[p.number_key];
          if (!found) {
            stats.parts_added += 1;
            var row = { number_display: p.number_display, number_key: p.number_key, kind: p.kind,
                        manufacturer: p.manufacturer, supplier: p.supplier || '',
                        price_cents: (p.price_cents == null ? null : p.price_cents),
                        notes: p.notes || '', unverified: p.unverified ? 1 : 0,
                        created_at: p.created_at || new Date().toISOString(),
                        updated_at: p.updated_at || new Date().toISOString() };
            return DB.put('parts', row).then(function (id) {
              partIdMap[p.id] = id;
              row.id = id;
              byKey[p.number_key] = row;
            });
          }
          partIdMap[p.id] = found.id;
          var incomingTime = Date.parse(p.updated_at || 0) || 0;
          var localTime = Date.parse(found.updated_at || 0) || 0;
          if (incomingTime <= localTime) return null;
          stats.parts_updated += 1;
          var updated = { id: found.id, number_display: p.number_display, number_key: p.number_key,
                           kind: p.kind, manufacturer: p.manufacturer, supplier: p.supplier || '',
                           price_cents: (p.price_cents == null ? null : p.price_cents),
                           notes: p.notes || '', unverified: p.unverified ? 1 : 0,
                           created_at: found.created_at, updated_at: p.updated_at };
          byKey[p.number_key] = updated;
          return DB.put('parts', updated);
        });
      }, Promise.resolve()).then(function () { return partIdMap; });
    });
  }

  function mergeLinks(incomingLinks, kitLineIdMap, partIdMap, stats) {
    var byLocalLine = {};
    incomingLinks.forEach(function (l) {
      var lineId = kitLineIdMap[l.kit_line_id], partId = partIdMap[l.part_id];
      if (!lineId || !partId) return; // orphaned reference — shouldn't happen, skip defensively
      (byLocalLine[lineId] = byLocalLine[lineId] || []).push(partId);
    });

    return Object.keys(byLocalLine).reduce(function (chain, lineIdStr) {
      var lineId = Number(lineIdStr);
      return chain.then(function () {
        return DB.byIndex('kit_line_parts', 'kit_line_id', lineId).then(function (existing) {
          var have = {};
          existing.forEach(function (e) { have[e.part_id] = true; });
          return byLocalLine[lineId].reduce(function (c2, partId) {
            return c2.then(function () {
              if (have[partId]) return null;
              have[partId] = true;
              stats.links_added += 1;
              return DB.put('kit_line_parts', { kit_line_id: lineId, part_id: partId, sort: existing.length });
            });
          }, Promise.resolve());
        });
      });
    }, Promise.resolve());
  }

  global.Backup = { exportAll: exportAll, download: download,
                    importAll: importAll, mergeAll: mergeAll, readFile: readFile };
})(window);
