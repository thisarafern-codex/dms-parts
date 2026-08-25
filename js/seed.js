/* Load seed/models.json into IndexedDB.

   First run inserts everything. A later re-seed (dad's invoicing app gained new
   machines, we regenerated the file) MERGES: it adds new models and new filter
   slots, refreshes the counts, and never deletes anything — because by then the
   part numbers he has typed hang off those rows. */
(function (global) {
  'use strict';

  function partKey(number) {
    return String(number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function loadFile() {
    return fetch('seed/models.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('seed/models.json missing (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  function ensure(onProgress) {
    var report = onProgress || function () {};
    return DB.meta('seed_version').then(function (current) {
      return loadFile().then(function (seed) {
        if (current === seed.seed_version) return { skipped: true };
        return DB.count('models').then(function (n) {
          return (n === 0 ? insertAll(seed, report) : merge(seed, report))
            .then(function (result) {
              return DB.meta('seed_version', seed.seed_version).then(function () {
                return DB.meta('seed_generated_at', seed.generated_at);
              }).then(function () { return result; });
            });
        });
      });
    });
  }

  function insertAll(seed, report) {
    report('Setting up the machine list…');
    return DB.bulk('brands', seed.brands.map(function (b) {
      return { name: b.name, sort: b.sort };
    })).then(function () {
      var models = seed.models.map(function (m) {
        return {
          key: m.key, brand: m.brand, display: m.display,
          aliases: m.aliases || [], machine_count: m.machine_count || 0,
          invoice_count: m.invoice_count || 0,
          hidden: m.hidden ? 1 : 0, hidden_reason: m.hidden_reason || null,
          brand_locked: 0, source: 'seed'
        };
      });
      return DB.bulk('models', models).then(function (ids) {
        report('Building service kits…');
        var kits = [], kitOwner = [];
        seed.models.forEach(function (m, i) {
          (m.kits || []).forEach(function (k) {
            kits.push({ model_id: ids[i], label: k.label,
                        interval_hours: k.interval_hours, sort: k.sort || 0 });
            kitOwner.push(k);
          });
        });
        return DB.bulk('kits', kits).then(function (kitIds) {
          var lines = [];
          kitOwner.forEach(function (k, i) {
            (k.lines || []).forEach(function (l, j) {
              lines.push({ kit_id: kitIds[i], slot: l.slot, qty: l.qty || 1,
                           sort: j, use_count: l.use_count || 0,
                           last_used_at: l.last_used_at || null, notes: null });
            });
          });
          return DB.bulk('kit_lines', lines).then(function () {
            return { models: models.length, kits: kits.length, lines: lines.length };
          });
        });
      });
    });
  }

  /* Additive merge — the reason a re-seed is safe to run at any time. */
  function merge(seed, report) {
    report('Updating the machine list…');
    var added = { models: 0, kits: 0, lines: 0, updated: 0 };
    return DB.all('models').then(function (existing) {
      var byKey = {};
      existing.forEach(function (m) { byKey[m.key] = m; });

      return seed.models.reduce(function (chain, m) {
        return chain.then(function () {
          var found = byKey[m.key];
          if (!found) {
            added.models += 1;
            return DB.put('models', {
              key: m.key, brand: m.brand, display: m.display,
              aliases: m.aliases || [], machine_count: m.machine_count || 0,
              invoice_count: m.invoice_count || 0,
              hidden: m.hidden ? 1 : 0, hidden_reason: m.hidden_reason || null,
              brand_locked: 0, source: 'seed'
            }).then(function (id) { return addKits(id, m, added); });
          }
          // Refresh counts and aliases, but keep any brand dad set by hand.
          found.machine_count = m.machine_count || 0;
          found.invoice_count = m.invoice_count || 0;
          found.aliases = m.aliases || found.aliases;
          if (!found.brand_locked) found.brand = m.brand;
          added.updated += 1;
          return DB.put('models', found).then(function () {
            return addMissingSlots(found.id, m, added);
          });
        });
      }, Promise.resolve()).then(function () { return added; });
    });
  }

  function addKits(modelId, m, added) {
    return (m.kits || []).reduce(function (chain, k) {
      return chain.then(function () {
        added.kits += 1;
        return DB.put('kits', { model_id: modelId, label: k.label,
                                interval_hours: k.interval_hours, sort: k.sort || 0 })
          .then(function (kitId) {
            return (k.lines || []).reduce(function (c2, l, j) {
              return c2.then(function () {
                added.lines += 1;
                return DB.put('kit_lines', { kit_id: kitId, slot: l.slot, qty: l.qty || 1,
                                             sort: j, use_count: l.use_count || 0,
                                             last_used_at: l.last_used_at || null, notes: null });
              });
            }, Promise.resolve());
          });
      });
    }, Promise.resolve());
  }

  /* New history can reveal a filter position we didn't know about. Add it to
     the model's first kit; never remove a slot, it may hold part numbers. */
  function addMissingSlots(modelId, m, added) {
    var seedLines = (m.kits && m.kits[0] && m.kits[0].lines) || [];
    if (!seedLines.length) return Promise.resolve();
    return DB.byIndex('kits', 'model_id', modelId).then(function (kits) {
      if (!kits.length) return addKits(modelId, m, added);
      var kit = kits[0];
      return DB.byIndex('kit_lines', 'kit_id', kit.id).then(function (lines) {
        var have = {};
        lines.forEach(function (l) { have[l.slot] = true; });
        var missing = seedLines.filter(function (l) { return !have[l.slot]; });
        return missing.reduce(function (chain, l, j) {
          return chain.then(function () {
            added.lines += 1;
            return DB.put('kit_lines', { kit_id: kit.id, slot: l.slot, qty: l.qty || 1,
                                         sort: lines.length + j, use_count: l.use_count || 0,
                                         last_used_at: l.last_used_at || null, notes: null });
          });
        }, Promise.resolve());
      });
    });
  }

  global.Seed = { ensure: ensure, partKey: partKey, loadFile: loadFile };
})(window);
