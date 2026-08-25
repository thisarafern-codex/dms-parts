/* DMS Parts — screens and routing.
   Single-file vanilla SPA, hash routing, no framework. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var titleEl = document.getElementById('title');
  var subEl = document.getElementById('subtitle');
  var backBtn = document.getElementById('back');

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setHead(title, sub, canBack) {
    titleEl.childNodes[0].nodeValue = title;
    subEl.textContent = sub || '';
    backBtn.hidden = !canBack;
    document.title = title === 'DMS Parts' ? 'DMS Parts' : title + ' — DMS Parts';
  }

  function render(html) { app.innerHTML = html; window.scrollTo(0, 0); }

  var toastEl = document.getElementById('toast'), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  function go(hash) { location.hash = hash; }

  function fail(err) {
    console.error(err);
    render('<div class="note warn"><b>Something went wrong.</b><br>' +
           esc(err && err.message || err) + '</div>' +
           '<a class="btn ghost" href="#/">Back to the start</a>');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // Parts fitted to a kit line, resolved through the join store.
  function partsForLine(lineId) {
    return DB.byIndex('kit_line_parts', 'kit_line_id', lineId).then(function (links) {
      links.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
      return Promise.all(links.map(function (l) {
        return DB.get('parts', l.part_id).then(function (p) {
          return p ? { link: l, part: p } : null;
        });
      })).then(function (rows) { return rows.filter(Boolean); });
    });
  }

  // ---------------------------------------------------------------- screens

  function screenBrands() {
    setHead('DMS Parts', 'Pick a brand', false);
    return DB.all('models').then(function (models) {
      var live = models.filter(function (m) { return !m.hidden; });
      var counts = {};
      live.forEach(function (m) {
        var b = counts[m.brand] || (counts[m.brand] = { n: 0, inv: 0 });
        b.n += 1; b.inv += m.invoice_count || 0;
      });
      return DB.all('brands').then(function (brands) {
        brands.sort(function (a, b) { return a.sort - b.sort; });
        var known = brands.filter(function (b) { return counts[b.name]; });
        if (!known.length) {
          return render('<p class="empty">No machines yet.</p>');
        }
        var html = '<div class="btnrow">' +
          '<a class="btn ghost" href="#/search">Search a part number</a></div>' +
          '<div class="grid">';
        known.forEach(function (b) {
          var c = counts[b.name];
          html += '<a class="tile" href="#/brand/' + encodeURIComponent(b.name) + '">' +
                  '<b>' + esc(b.name) + '</b><span>' +
                  plural(c.n, 'machine') + '</span></a>';
        });
        html += '</div>';
        render(html);
      });
    });
  }

  function screenBrand(name) {
    setHead(name, 'Pick a machine', true);
    return DB.byIndex('models', 'brand', name).then(function (models) {
      var live = models.filter(function (m) { return !m.hidden; });
      live.sort(function (a, b) {
        return (b.invoice_count - a.invoice_count) ||
               (b.machine_count - a.machine_count) ||
               a.display.localeCompare(b.display);
      });
      if (!live.length) return render('<p class="empty">No machines under ' + esc(name) + '.</p>');

      var html = '<label for="mfilter">Find a machine</label>' +
        '<input id="mfilter" type="search" placeholder="e.g. U55" autocomplete="off" ' +
        'autocapitalize="characters" enterkeyhint="search">' +
        '<ul class="list" id="mlist">';
      live.forEach(function (m) {
        html += modelRow(m);
      });
      html += '</ul>';
      render(html);

      // Search matches the aliases too, so typing 'U 55' finds 'U55-4' even
      // though that spelling was folded away.
      var input = document.getElementById('mfilter');
      input.addEventListener('input', function () {
        var q = Seed.partKey(input.value);
        var list = document.getElementById('mlist');
        var shown = 0;
        list.innerHTML = live.filter(function (m) {
          if (!q) return true;
          if (m.key.indexOf(q) !== -1) return true;
          return (m.aliases || []).some(function (a) {
            return Seed.partKey(a).indexOf(q) !== -1;
          });
        }).map(function (m) { shown += 1; return modelRow(m); }).join('') ||
          '<li class="empty">Nothing matches &ldquo;' + esc(input.value) + '&rdquo;.</li>';
      });
    });
  }

  function modelRow(m) {
    var bits = [];
    if (m.invoice_count) bits.push(plural(m.invoice_count, 'invoice'));
    if (m.machine_count) bits.push(plural(m.machine_count, 'machine'));
    return '<li><a class="row" href="#/model/' + encodeURIComponent(m.key) + '">' +
      '<span class="grow"><span class="title">' + esc(m.display) + '</span>' +
      '<span class="meta">' + esc(bits.join(' · ')) + '</span></span>' +
      '<span class="chev">&rsaquo;</span></a></li>';
  }

  function screenModel(key) {
    return DB.oneByIndex('models', 'key', key).then(function (model) {
      if (!model) return render('<p class="empty">That machine is not on file.</p>');
      setHead(model.display, model.brand, true);
      return DB.byIndex('kits', 'model_id', model.id).then(function (kits) {
        kits.sort(function (a, b) {
          if (a.interval_hours && b.interval_hours) return a.interval_hours - b.interval_hours;
          if (a.interval_hours) return -1;
          if (b.interval_hours) return 1;
          return (a.sort || 0) - (b.sort || 0);
        });
        return Promise.all(kits.map(function (k) {
          return DB.byIndex('kit_lines', 'kit_id', k.id).then(function (lines) {
            return Promise.all(lines.map(function (l) {
              return DB.byIndex('kit_line_parts', 'kit_line_id', l.id);
            })).then(function (linkSets) {
              var filled = linkSets.filter(function (s) { return s.length; }).length;
              return { kit: k, lines: lines.length, filled: filled };
            });
          });
        })).then(function (rows) {
          var html = '';
          if (model.aliases && model.aliases.length > 1) {
            html += '<div class="note small">Also written as ' +
                    esc(model.aliases.slice(0, 6).join(', ')) + '.</div>';
          }
          html += '<h3>Service kits</h3><ul class="list">';
          rows.forEach(function (r) {
            var state = r.lines === 0 ? 'No filters listed yet'
              : r.filled === r.lines ? 'All ' + r.lines + ' part numbers filled in'
              : r.filled + ' of ' + r.lines + ' part numbers filled in';
            html += '<li><a class="row" href="#/kit/' + r.kit.id + '">' +
              '<span class="grow"><span class="title">' + esc(kitName(r.kit)) + '</span>' +
              '<span class="meta">' + esc(state) + '</span></span>' +
              '<span class="chev">&rsaquo;</span></a></li>';
          });
          html += '</ul><div class="btnrow">' +
            '<button class="btn ghost" data-act="add-kit" data-model="' + model.id + '">' +
            '+ Add a service interval</button></div>';
          render(html);
        });
      });
    });
  }

  function kitName(kit) {
    if (kit.interval_hours) return kit.interval_hours + ' hour service';
    return kit.label || 'Service';
  }

  // ------------------------------------------------------------- kit screen
  function screenKit(id) {
    id = Number(id);
    return DB.get('kits', id).then(function (kit) {
      if (!kit) return render('<p class="empty">That kit is not on file.</p>');
      return DB.get('models', kit.model_id).then(function (model) {
        setHead(model ? model.display : 'Kit', kitName(kit), true);
        return DB.byIndex('kit_lines', 'kit_id', id).then(function (lines) {
          lines.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
          return Promise.all(lines.map(function (l) {
            return partsForLine(l.id).then(function (parts) {
              return { line: l, parts: parts };
            });
          })).then(function (rows) {
            var html = '';
            if (!rows.length) {
              html += '<div class="note">No filter positions on this kit yet. ' +
                      'Add the ones this machine takes.</div>';
            }
            rows.forEach(function (r) {
              html += slotHtml(r.line, r.parts);
            });
            html += '<div class="btnrow">' +
              '<button class="btn ghost" data-act="add-slot" data-kit="' + id + '">+ Add a filter position</button>' +
              '<button class="btn ghost" data-act="copy-kit" data-kit="' + id + '">Copy from another machine</button>' +
              '</div>' +
              '<div class="btnrow"><button class="btn danger" data-act="del-kit" data-kit="' + id + '">Delete this kit</button></div>';
            render(html);
          });
        });
      });
    });
  }

  function slotHtml(line, parts) {
    var hint = [];
    if (line.use_count) hint.push('fitted ' + plural(line.use_count, 'time') + ' historically');
    if (line.qty && line.qty !== 1) hint.push('qty ' + line.qty);
    var html = '<section class="slot"><span class="name">' + esc(line.slot) + '</span>';
    if (hint.length) html += '<span class="hint">' + esc(hint.join(' · ')) + '</span>';
    if (!parts.length) {
      html += '<p class="muted small" style="margin:0 0 .6rem">No part number yet.</p>';
    }
    parts.forEach(function (r) {
      var p = r.part;
      var meta = [p.manufacturer, p.supplier].filter(Boolean).join(' · ');
      html += '<div class="part">' +
        '<button class="num pn ' + (p.kind === 'oem' ? 'oem' : 'after') + '" ' +
          'data-act="copy" data-num="' + esc(p.number_display) + '" ' +
          'title="Tap to copy">' + esc(p.number_display) + '</button>' +
        '<div class="partmeta">' +
          '<span class="tag ' + (p.kind === 'oem' ? 'oem' : 'after') + '">' +
            (p.kind === 'oem' ? 'Genuine' : 'Aftermarket') + '</span>' +
          (p.unverified ? '<span class="tag unverified">Unchecked</span>' : '') +
          // The two buttons wrap as one unit, so they can never end up split
          // across lines when the text size is turned right up.
          '<span class="partacts">' +
            '<button class="iconbtn" data-act="edit-part" data-part="' + p.id + '" ' +
              'data-line="' + line.id + '" aria-label="Edit ' + esc(p.number_display) + '">&#9998;</button>' +
            '<button class="iconbtn" data-act="unlink" data-link="' + r.link.id + '" ' +
              'aria-label="Remove ' + esc(p.number_display) + ' from this position">&times;</button>' +
          '</span>' +
          // Supplier detail gets its own line: at the largest text size it has
          // nowhere near enough room beside the tag and the two buttons.
          (meta ? '<span class="muted small partsub">' + esc(meta) + '</span>' : '') +
        '</div></div>';
    });
    html += '<div class="btnrow" style="margin:.6rem 0 0">' +
      '<button class="btn" data-act="add-part" data-line="' + line.id + '">+ Add part number</button>' +
      '<button class="iconbtn" data-act="del-slot" data-line="' + line.id + '" ' +
        'aria-label="Remove the ' + esc(line.slot) + ' position">&#128465;</button>' +
      '</div></section>';
    return html;
  }

  window.UI = { esc: esc, render: render, setHead: setHead, toast: toast, go: go,
                fail: fail, plural: plural, partsForLine: partsForLine,
                kitName: kitName, screenKit: screenKit, screenBrands: screenBrands,
                screenBrand: screenBrand, screenModel: screenModel,
                slotHtml: slotHtml, modelRow: modelRow };
})();

/* ---- part entry, search, cleanup, backup, routing ---------------------- */
(function () {
  'use strict';

  var esc = UI.esc, render = UI.render, setHead = UI.setHead, toast = UI.toast;
  var go = UI.go, fail = UI.fail, plural = UI.plural;
  var app = document.getElementById('app');

  function money(cents) {
    if (cents === null || cents === undefined || cents === '') return '';
    return '$' + (cents / 100).toFixed(2);
  }
  function toCents(text) {
    var n = parseFloat(String(text).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : Math.round(n * 100);
  }

  // ------------------------------------------------------------ part form
  function screenPart(lineId, partId) {
    lineId = Number(lineId);
    return DB.get('kit_lines', lineId).then(function (line) {
      if (!line) return render('<p class="empty">That filter position is gone.</p>');
      var loadPart = partId ? DB.get('parts', Number(partId)) : Promise.resolve(null);
      return Promise.all([loadPart, DB.all('parts')]).then(function (res) {
        var part = res[0], allParts = res[1];
        setHead(line.slot, part ? 'Edit part number' : 'Add a part number', true);

        var kind = part ? part.kind : 'oem';
        var html = '<label for="num">Part number</label>' +
          '<input id="num" class="pn" type="text" autocomplete="off" ' +
          'autocapitalize="characters" spellcheck="false" enterkeyhint="done" ' +
          'value="' + esc(part ? part.number_display : '') + '" ' +
          'placeholder="e.g. HH164-32430">' +
          '<div id="dupe"></div>' +
          '<label>Genuine or aftermarket?</label>' +
          '<div class="seg" id="kind">' +
            '<button type="button" data-kind="oem" aria-pressed="' + (kind === 'oem') + '">Genuine</button>' +
            '<button type="button" data-kind="aftermarket" aria-pressed="' + (kind !== 'oem') + '">Aftermarket</button>' +
          '</div>' +
          '<label for="mfr">Make <span class="muted small">(optional)</span></label>' +
          '<input id="mfr" type="text" autocomplete="off" value="' + esc(part ? part.manufacturer : '') + '" placeholder="Kubota, Donaldson…">' +
          '<label for="sup">Where from <span class="muted small">(optional)</span></label>' +
          '<input id="sup" type="text" autocomplete="off" value="' + esc(part ? part.supplier : '') + '" placeholder="Norwood, Repco…">' +
          '<label for="price">Price each <span class="muted small">(optional)</span></label>' +
          '<input id="price" type="text" inputmode="decimal" value="' + esc(part ? money(part.price_cents) : '') + '" placeholder="$0.00">' +
          '<label for="notes">Notes <span class="muted small">(optional)</span></label>' +
          '<textarea id="notes" rows="2">' + esc(part ? part.notes : '') + '</textarea>';

        if (part && part.unverified) {
          html += '<div class="note warn small">This number came from a note and ' +
                  'has not been checked yet. Saving marks it checked.</div>';
        }
        html += '<div class="btnrow" style="margin-top:1.25rem">' +
          '<button class="btn" data-act="save-part" data-line="' + lineId + '" ' +
            'data-part="' + (part ? part.id : '') + '">Save</button>' +
          '<button class="btn ghost" data-act="cancel">Cancel</button></div>';

        if (!part && allParts.length) {
          html += '<h3>Or reuse a number you already have</h3>' +
            '<p class="muted small">The same filter often fits several machines &mdash; ' +
            'no need to type it twice.</p>' +
            '<label for="reuse" class="small">Search saved numbers</label>' +
            '<input id="reuse" type="search" autocomplete="off" placeholder="Type any part of a number">' +
            '<ul class="list" id="reuselist"></ul>';
        }
        render(html);

        var num = document.getElementById('num');
        num.addEventListener('input', function () { checkDupe(num.value, part); });
        if (!part) num.focus();
        checkDupe(num.value, part);

        var reuse = document.getElementById('reuse');
        if (reuse) {
          allParts.sort(function (a, b) { return a.number_key.localeCompare(b.number_key); });
          reuse.addEventListener('input', function () {
            var q = Seed.partKey(reuse.value);
            var list = document.getElementById('reuselist');
            if (!q) { list.innerHTML = ''; return; }
            var hits = allParts.filter(function (p) {
              return p.number_key.indexOf(q) !== -1;
            }).slice(0, 12);
            list.innerHTML = hits.length ? hits.map(function (p) {
              return '<li><button class="row" data-act="link-existing" data-part="' + p.id +
                '" data-line="' + lineId + '"><span class="grow">' +
                '<span class="title pn">' + esc(p.number_display) + '</span>' +
                '<span class="meta">' + esc([p.kind === 'oem' ? 'Genuine' : 'Aftermarket',
                  p.manufacturer].filter(Boolean).join(' · ')) + '</span></span>' +
                '<span class="chev">+</span></button></li>';
            }).join('') : '<li class="empty small">No saved number matches that.</li>';
          });
        }
      });
    });
  }

  /* Warn before the same filter forks into two records under two spellings. */
  function checkDupe(value, currentPart) {
    var box = document.getElementById('dupe');
    if (!box) return;
    var key = Seed.partKey(value);
    if (!key) { box.innerHTML = ''; return; }
    DB.oneByIndex('parts', 'number_key', key).then(function (hit) {
      if (!hit || (currentPart && hit.id === currentPart.id)) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="note small" style="margin-top:.5rem">' +
        'Already saved as <b class="pn">' + esc(hit.number_display) + '</b>' +
        (hit.manufacturer ? ' (' + esc(hit.manufacturer) + ')' : '') +
        '. Saving will link to that same part.</div>';
    });
  }

  function saveParticular(lineId, partId) {
    var display = document.getElementById('num').value.trim();
    if (!display) { toast('Type a part number first.'); return Promise.resolve(); }
    var key = Seed.partKey(display);
    var pressed = document.querySelector('#kind button[aria-pressed="true"]');
    var fields = {
      number_display: display,
      number_key: key,
      kind: pressed ? pressed.getAttribute('data-kind') : 'oem',
      manufacturer: document.getElementById('mfr').value.trim(),
      supplier: document.getElementById('sup').value.trim(),
      price_cents: toCents(document.getElementById('price').value),
      notes: document.getElementById('notes').value.trim(),
      unverified: 0,
      updated_at: new Date().toISOString()
    };

    return DB.oneByIndex('parts', 'number_key', key).then(function (existing) {
      // Editing this record, or merging onto one that already holds the number.
      var target = null;
      if (partId) target = Number(partId);
      if (existing && (!target || existing.id !== target)) target = existing.id;

      if (target) {
        return DB.get('parts', target).then(function (row) {
          Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
          return DB.put('parts', row).then(function () { return target; });
        });
      }
      fields.created_at = new Date().toISOString();
      return DB.put('parts', fields);
    }).then(function (pid) {
      return link(lineId, pid).then(function () {
        toast('Saved ' + display);
        history.back();
      });
    });
  }

  function link(lineId, partId) {
    return DB.byIndex('kit_line_parts', 'kit_line_id', Number(lineId)).then(function (links) {
      if (links.some(function (l) { return l.part_id === partId; })) return null;
      return DB.put('kit_line_parts', { kit_line_id: Number(lineId), part_id: partId,
                                        sort: links.length });
    });
  }

  // --------------------------------------------------------------- search
  function screenSearch() {
    setHead('Find a part', 'Search every machine', true);
    render('<label for="q">Part number</label>' +
      '<input id="q" class="pn" type="search" autocomplete="off" ' +
      'autocapitalize="characters" spellcheck="false" placeholder="Type the number in your hand">' +
      '<div id="results"><p class="muted">Type a few characters to see which ' +
      'machines take that filter.</p></div>');
    var q = document.getElementById('q');
    q.focus();
    q.addEventListener('input', function () {
      var key = Seed.partKey(q.value);
      var box = document.getElementById('results');
      if (key.length < 2) {
        box.innerHTML = '<p class="muted">Type a few characters to see which ' +
                        'machines take that filter.</p>';
        return;
      }
      DB.all('parts').then(function (parts) {
        var hits = parts.filter(function (p) { return p.number_key.indexOf(key) !== -1; });
        if (!hits.length) {
          box.innerHTML = '<p class="empty">Nothing saved matches that number yet.</p>';
          return;
        }
        Promise.all(hits.slice(0, 25).map(whereUsed)).then(function (rows) {
          box.innerHTML = rows.map(function (r) {
            var uses = r.uses.length
              ? r.uses.map(function (u) {
                  return '<li><a class="row" href="#/kit/' + u.kitId + '">' +
                    '<span class="grow"><span class="title">' + esc(u.model) + '</span>' +
                    '<span class="meta">' + esc(u.kit + ' · ' + u.slot) + '</span></span>' +
                    '<span class="chev">&rsaquo;</span></a></li>';
                }).join('')
              : '<li class="empty small">Not attached to any machine.</li>';
            return '<section class="slot"><span class="name pn">' + esc(r.part.number_display) +
              '</span><span class="hint">' +
              esc([r.part.kind === 'oem' ? 'Genuine' : 'Aftermarket', r.part.manufacturer,
                   r.part.supplier, money(r.part.price_cents)].filter(Boolean).join(' · ')) +
              '</span><ul class="list">' + uses + '</ul></section>';
          }).join('');
        });
      });
    });
  }

  function whereUsed(part) {
    return DB.byIndex('kit_line_parts', 'part_id', part.id).then(function (links) {
      return Promise.all(links.map(function (l) {
        return DB.get('kit_lines', l.kit_line_id).then(function (line) {
          if (!line) return null;
          return DB.get('kits', line.kit_id).then(function (kit) {
            if (!kit) return null;
            return DB.get('models', kit.model_id).then(function (model) {
              return model ? { kitId: kit.id, model: model.display,
                               kit: UI.kitName(kit), slot: line.slot } : null;
            });
          });
        });
      })).then(function (uses) {
        return { part: part, uses: uses.filter(Boolean) };
      });
    });
  }

  window.UI2 = { screenPart: screenPart, screenSearch: screenSearch,
                 saveParticular: saveParticular, link: link, money: money,
                 toCents: toCents, whereUsed: whereUsed };
})();

/* ---- cleanup, backup, menu, actions, router --------------------------- */
(function () {
  'use strict';

  var esc = UI.esc, render = UI.render, setHead = UI.setHead, toast = UI.toast;
  var go = UI.go, fail = UI.fail, plural = UI.plural;
  var app = document.getElementById('app');

  // -------------------------------------------------------------- cleanup
  function screenCleanup() {
    setHead('Tidy up', 'Fix names and brands', true);
    return Promise.all([DB.all('models'), DB.all('brands')]).then(function (res) {
      var models = res[0], brands = res[1];
      var names = brands.map(function (b) { return b.name; }).sort();
      var unassigned = models.filter(function (m) { return !m.hidden && m.brand === 'Unassigned'; });
      var hidden = models.filter(function (m) { return m.hidden; });
      var live = models.filter(function (m) { return !m.hidden; })
        .sort(function (a, b) { return a.display.localeCompare(b.display); });

      var html = '<div class="note small">Nothing here touches the invoicing ' +
        'app&rsquo;s database &mdash; these are this app&rsquo;s own copies.</div>';

      html += '<h3>Machines with no brand (' + unassigned.length + ')</h3>';
      html += unassigned.length ? '<ul class="list">' + unassigned.map(function (m) {
        return '<li class="row"><span class="grow"><span class="title">' + esc(m.display) +
          '</span><span class="meta">' + plural(m.machine_count, 'machine') + '</span></span>' +
          brandSelect(m, names) + '</li>';
      }).join('') + '</ul>' : '<p class="muted small">All sorted.</p>';

      html += '<h3>Hidden rows (' + hidden.length + ')</h3>' +
        '<p class="muted small">These came out of old invoice wording rather than ' +
        'being real machines. Bring one back if it should be here.</p>';
      html += hidden.length ? '<ul class="list">' + hidden.map(function (m) {
        return '<li class="row"><span class="grow"><span class="title">' + esc(m.display) +
          '</span><span class="meta">' + esc(m.hidden_reason || '') + '</span></span>' +
          '<button class="btn ghost" data-act="unhide" data-model="' + m.id + '">Restore</button></li>';
      }).join('') + '</ul>' : '<p class="muted small">None.</p>';

      html += '<h3>All machines (' + live.length + ')</h3>' +
        '<p class="muted small">Rename one, move it to another brand, or merge two ' +
        'that are the same machine.</p><ul class="list">';
      live.forEach(function (m) {
        html += '<li class="row"><span class="grow"><span class="title">' + esc(m.display) +
          '</span><span class="meta">' + esc(m.brand) + ' · ' +
          plural(m.machine_count, 'machine') + '</span></span>' +
          '<button class="btn ghost" data-act="edit-model" data-model="' + m.id + '">Edit</button></li>';
      });
      html += '</ul>';
      render(html);
    });
  }

  function brandSelect(model, names) {
    var opts = names.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === model.brand ? ' selected' : '') +
             '>' + esc(n) + '</option>';
    }).join('');
    return '<select data-act="set-brand" data-model="' + model.id + '" ' +
           'style="max-width:12rem" aria-label="Brand for ' + esc(model.display) + '">' +
           opts + '</select>';
  }

  function screenEditModel(id) {
    id = Number(id);
    return Promise.all([DB.get('models', id), DB.all('models'), DB.all('brands')])
      .then(function (res) {
        var model = res[0], all = res[1], brands = res[2];
        if (!model) return render('<p class="empty">Gone.</p>');
        setHead(model.display, 'Edit machine', true);
        var others = all.filter(function (m) { return m.id !== id && !m.hidden; })
          .sort(function (a, b) { return a.display.localeCompare(b.display); });

        var html = '<label for="disp">Name</label>' +
          '<input id="disp" type="text" value="' + esc(model.display) + '">' +
          '<label for="brand">Brand</label><select id="brand">' +
          brands.map(function (b) {
            return '<option' + (b.name === model.brand ? ' selected' : '') + '>' + esc(b.name) + '</option>';
          }).join('') + '</select>' +
          '<div class="btnrow" style="margin-top:1rem">' +
          '<button class="btn" data-act="save-model" data-model="' + id + '">Save</button>' +
          '<button class="btn ghost" data-act="cancel">Cancel</button></div>';

        if (model.aliases && model.aliases.length) {
          html += '<h3>Written as</h3><p class="muted small">' +
                  esc(model.aliases.join(', ')) + '</p>';
        }

        html += '<h3>Merge into another machine</h3>' +
          '<p class="muted small">Use this when the same digger ended up listed twice. ' +
          'Its service kits move across and this entry disappears.</p>' +
          '<select id="mergeinto"><option value="">Choose a machine…</option>' +
          others.map(function (m) {
            return '<option value="' + m.id + '">' + esc(m.display) + ' (' + esc(m.brand) + ')</option>';
          }).join('') + '</select>' +
          '<div class="btnrow" style="margin-top:.75rem">' +
          '<button class="btn danger" data-act="merge-model" data-model="' + id + '">Merge</button></div>' +
          '<h3>Remove</h3><div class="btnrow">' +
          '<button class="btn danger" data-act="hide-model" data-model="' + id + '">Hide this machine</button></div>';
        render(html);
      });
  }

  function mergeModels(sourceId, targetId) {
    return Promise.all([DB.get('models', sourceId), DB.get('models', targetId)])
      .then(function (res) {
        var source = res[0], target = res[1];
        if (!source || !target) throw new Error('One of those machines is gone.');
        return DB.byIndex('kits', 'model_id', sourceId).then(function (kits) {
          return kits.reduce(function (chain, k) {
            return chain.then(function () {
              k.model_id = targetId;
              k.label = k.label + ' (from ' + source.display + ')';
              return DB.put('kits', k);
            });
          }, Promise.resolve());
        }).then(function () {
          target.aliases = (target.aliases || []).concat(source.aliases || [])
            .filter(function (v, i, a) { return a.indexOf(v) === i; });
          target.machine_count = (target.machine_count || 0) + (source.machine_count || 0);
          target.invoice_count = (target.invoice_count || 0) + (source.invoice_count || 0);
          return DB.put('models', target);
        }).then(function () {
          return DB.byIndex('machines', 'model_key', source.key).then(function (ms) {
            return ms.reduce(function (chain, m) {
              return chain.then(function () { m.model_key = target.key; return DB.put('machines', m); });
            }, Promise.resolve());
          });
        }).then(function () { return DB.del('models', sourceId); })
          .then(function () { return target; });
      });
  }

  // --------------------------------------------------------------- backup
  function screenBackup() {
    setHead('Backup', 'Keep a copy off the phone', true);
    return Promise.all([DB.count('parts'), DB.count('models'), DB.meta('last_backup_at'),
                        DB.meta('seed_generated_at')]).then(function (r) {
      var parts = r[0], models = r[1], last = r[2], seeded = r[3];
      var html = '<div class="note' + (parts && !last ? ' warn' : '') + '">' +
        '<b>' + plural(parts, 'part number') + '</b> saved on this phone, across ' +
        plural(models, 'machine') + '.<br>' +
        (last ? 'Last backup: ' + esc(new Date(last).toLocaleString())
              : 'You have never made a backup.') + '</div>';
      if (parts && !last) {
        html += '<div class="note warn"><b>This phone holds the only copy.</b> ' +
          'If it is lost or wiped, every part number goes with it. Save a backup ' +
          'to Drive or email it to yourself.</div>';
      }
      html += '<div class="btnrow">' +
        '<button class="btn wide" data-act="export">Save a backup file</button></div>' +
        '<h3>Restore</h3>' +
        '<p class="muted small">Loading a backup <b>replaces everything</b> on this ' +
        'phone with what is in the file.</p>' +
        '<input type="file" id="restore" accept="application/json,.json">' +
        '<div class="btnrow" style="margin-top:.75rem">' +
        '<button class="btn danger" data-act="import">Restore from that file</button></div>' +
        '<h3>Machine list</h3><p class="muted small">Seeded from the invoicing app' +
        (seeded ? ' on ' + esc(new Date(seeded).toLocaleDateString()) : '') + '.</p>';
      render(html);
    });
  }

  function screenMenu() {
    setHead('Menu', '', true);
    var size = currentSize();
    render('<h3>Text size</h3>' +
      '<div class="sizebtns" role="group" aria-label="Text size">' +
      [1, 2, 3].map(function (n) {
        return '<button data-size="' + n + '" aria-pressed="' +
          (String(n) === String(size)) + '">A</button>';
      }).join('') + '</div>' +
      '<p class="muted small">This is on top of your phone&rsquo;s own text size ' +
      'setting, so it can go bigger still.</p>' +
      '<h3>Go to</h3>' +
      '<ul class="list">' +
      row('#/', 'Machines', 'Browse by brand') +
      row('#/search', 'Find a part number', 'Search everything saved') +
      row('#/cleanup', 'Tidy up', 'Fix names, brands and duplicates') +
      row('#/backup', 'Backup', 'Save or restore your part numbers') +
      '</ul>');
    function row(href, title, meta) {
      return '<li><a class="row" href="' + href + '"><span class="grow">' +
        '<span class="title">' + title + '</span><span class="meta">' + meta + '</span></span>' +
        '<span class="chev">&rsaquo;</span></a></li>';
    }
  }

  // -------------------------------------------------------------- actions
  var ACTIONS = {
    copy: function (el) {
      var text = el.getAttribute('data-num');
      var done = function () { toast('Copied ' + text); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { toast(text); });
      } else { toast(text); }
    },
    cancel: function () { history.back(); },
    'add-part': function (el) { go('#/part/' + el.getAttribute('data-line')); },
    'edit-part': function (el) {
      go('#/part/' + el.getAttribute('data-line') + '/' + el.getAttribute('data-part'));
    },
    'save-part': function (el) {
      UI2.saveParticular(el.getAttribute('data-line'), el.getAttribute('data-part')).catch(fail);
    },
    'link-existing': function (el) {
      UI2.link(el.getAttribute('data-line'), Number(el.getAttribute('data-part')))
        .then(function () { toast('Added'); history.back(); }).catch(fail);
    },
    unlink: function (el) {
      DB.del('kit_line_parts', Number(el.getAttribute('data-link')))
        .then(function () { toast('Removed'); route(); }).catch(fail);
    },
    'add-slot': function (el) {
      var kitId = Number(el.getAttribute('data-kit'));
      var name = prompt('Which filter position? e.g. Engine oil filter');
      if (!name) return;
      DB.byIndex('kit_lines', 'kit_id', kitId).then(function (lines) {
        return DB.put('kit_lines', { kit_id: kitId, slot: name.trim(), qty: 1,
                                     sort: lines.length, use_count: 0, notes: null });
      }).then(function () { route(); }).catch(fail);
    },
    'del-slot': function (el) {
      var lineId = Number(el.getAttribute('data-line'));
      UI.partsForLine(lineId).then(function (parts) {
        var warn = parts.length
          ? 'This position holds ' + plural(parts.length, 'part number') + '. Remove it anyway?'
          : 'Remove this filter position?';
        if (!confirm(warn)) return null;
        return DB.byIndex('kit_line_parts', 'kit_line_id', lineId).then(function (links) {
          return links.reduce(function (c, l) {
            return c.then(function () { return DB.del('kit_line_parts', l.id); });
          }, Promise.resolve());
        }).then(function () { return DB.del('kit_lines', lineId); })
          .then(function () { toast('Removed'); route(); });
      }).catch(fail);
    },
    'add-kit': function (el) {
      var modelId = Number(el.getAttribute('data-model'));
      var hours = prompt('Service interval in hours? e.g. 500\n\nLeave blank to just name it.');
      if (hours === null) return;
      var n = parseInt(String(hours).replace(/[^0-9]/g, ''), 10);
      var label = n ? n + ' hour service' : (prompt('Name for this kit?') || 'Service');
      DB.byIndex('kits', 'model_id', modelId).then(function (kits) {
        return DB.put('kits', { model_id: modelId, label: label,
                                interval_hours: n || null, sort: kits.length });
      }).then(function (id) { go('#/kit/' + id); }).catch(fail);
    },
    'del-kit': function (el) {
      var kitId = Number(el.getAttribute('data-kit'));
      if (!confirm('Delete this whole kit and its filter positions?')) return;
      DB.get('kits', kitId).then(function (kit) {
        return DB.byIndex('kit_lines', 'kit_id', kitId).then(function (lines) {
          return lines.reduce(function (c, l) {
            return c.then(function () {
              return DB.byIndex('kit_line_parts', 'kit_line_id', l.id).then(function (links) {
                return links.reduce(function (c2, k) {
                  return c2.then(function () { return DB.del('kit_line_parts', k.id); });
                }, Promise.resolve());
              }).then(function () { return DB.del('kit_lines', l.id); });
            });
          }, Promise.resolve());
        }).then(function () { return DB.del('kits', kitId); })
          .then(function () { go('#/model/' + encodeURIComponent(kit ? kit.model_id : '')); })
          .then(function () { return DB.get('models', kit.model_id); })
          .then(function (m) { if (m) go('#/model/' + encodeURIComponent(m.key)); });
      }).catch(fail);
    },
    'copy-kit': function (el) {
      var kitId = Number(el.getAttribute('data-kit'));
      go('#/copy/' + kitId);
    },
    'set-brand': function (el) {
      var id = Number(el.getAttribute('data-model'));
      DB.get('models', id).then(function (m) {
        m.brand = el.value; m.brand_locked = 1;
        return DB.put('models', m);
      }).then(function () { toast('Moved to ' + el.value); }).catch(fail);
    },
    unhide: function (el) {
      var id = Number(el.getAttribute('data-model'));
      DB.get('models', id).then(function (m) {
        m.hidden = 0; m.hidden_reason = null; return DB.put('models', m);
      }).then(function () { toast('Restored'); route(); }).catch(fail);
    },
    'hide-model': function (el) {
      var id = Number(el.getAttribute('data-model'));
      if (!confirm('Hide this machine from the lists?')) return;
      DB.get('models', id).then(function (m) {
        m.hidden = 1; m.hidden_reason = 'hidden by hand'; return DB.put('models', m);
      }).then(function () { toast('Hidden'); go('#/cleanup'); }).catch(fail);
    },
    'edit-model': function (el) { go('#/editmodel/' + el.getAttribute('data-model')); },
    'save-model': function (el) {
      var id = Number(el.getAttribute('data-model'));
      var disp = document.getElementById('disp').value.trim();
      var brand = document.getElementById('brand').value;
      if (!disp) { toast('Give it a name.'); return; }
      DB.get('models', id).then(function (m) {
        m.display = disp;
        if (m.brand !== brand) { m.brand = brand; m.brand_locked = 1; }
        return DB.put('models', m);
      }).then(function () { toast('Saved'); go('#/cleanup'); }).catch(fail);
    },
    'merge-model': function (el) {
      var id = Number(el.getAttribute('data-model'));
      var target = Number(document.getElementById('mergeinto').value);
      if (!target) { toast('Pick a machine to merge into.'); return; }
      if (!confirm('Merge these two machines? This cannot be undone.')) return;
      mergeModels(id, target).then(function (t) {
        toast('Merged into ' + t.display); go('#/cleanup');
      }).catch(fail);
    },
    export: function () {
      Backup.download().then(function (r) {
        return DB.meta('last_backup_at', new Date().toISOString()).then(function () {
          toast(r.shared ? 'Backup shared' : 'Saved ' + r.name);
          route();
        });
      }).catch(fail);
    },
    import: function () {
      var input = document.getElementById('restore');
      if (!input.files || !input.files[0]) { toast('Choose a backup file first.'); return; }
      if (!confirm('Replace everything on this phone with that file?')) return;
      Backup.readFile(input.files[0])
        .then(Backup.importAll)
        .then(function (r) { toast('Restored ' + plural(r.rows, 'row')); go('#/'); })
        .catch(function (e) { toast(e.message); });
    }
  };

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (!fn) return;
    e.preventDefault();
    fn(el);
  });
  app.addEventListener('change', function (e) {
    var el = e.target.closest('select[data-act]');
    if (el && ACTIONS[el.getAttribute('data-act')]) ACTIONS[el.getAttribute('data-act')](el);
  });
  app.addEventListener('click', function (e) {
    var seg = e.target.closest('.seg button');
    if (!seg) return;
    Array.prototype.forEach.call(seg.parentNode.children, function (b) {
      b.setAttribute('aria-pressed', String(b === seg));
    });
  });

  // ---------------------------------------------------- copy-from-another
  function screenCopy(kitId) {
    kitId = Number(kitId);
    setHead('Copy filters', 'From another machine', true);
    return DB.all('models').then(function (models) {
      var live = models.filter(function (m) { return !m.hidden; })
        .sort(function (a, b) { return b.invoice_count - a.invoice_count; });
      render('<p class="muted">Pick a machine to copy its filter positions and part ' +
        'numbers from. Positions you have already filled in are left alone.</p>' +
        '<ul class="list">' + live.map(function (m) {
          return '<li><button class="row" data-act="do-copy" data-kit="' + kitId +
            '" data-model="' + m.id + '"><span class="grow"><span class="title">' +
            esc(m.display) + '</span><span class="meta">' + esc(m.brand) + '</span></span>' +
            '<span class="chev">&rsaquo;</span></button></li>';
        }).join('') + '</ul>');
    });
  }

  /* Copy filter positions AND their part numbers from another machine.

     Both machines are usually scaffolded with the same slots out of the invoice
     history, so matching only on missing slots would copy nothing useful — the
     numbers are the whole point. So: a slot the target doesn't have is created
     with its numbers; a slot it has but hasn't filled in yet receives the
     numbers; a slot that already holds numbers is left completely alone. */
  ACTIONS['do-copy'] = function (el) {
    var kitId = Number(el.getAttribute('data-kit'));
    var modelId = Number(el.getAttribute('data-model'));
    var made = 0, filled = 0;

    function copyLinks(fromLineId, toLineId) {
      return DB.byIndex('kit_line_parts', 'kit_line_id', fromLineId).then(function (links) {
        return links.reduce(function (chain, k, j) {
          return chain.then(function () {
            return DB.put('kit_line_parts', { kit_line_id: toLineId,
                                              part_id: k.part_id, sort: j });
          });
        }, Promise.resolve()).then(function () { return links.length; });
      });
    }

    DB.byIndex('kits', 'model_id', modelId).then(function (kits) {
      if (!kits.length) throw new Error('That machine has no kits to copy.');
      return DB.byIndex('kit_lines', 'kit_id', kits[0].id);
    }).then(function (srcLines) {
      return DB.byIndex('kit_lines', 'kit_id', kitId).then(function (mine) {
        var bySlot = {};
        mine.forEach(function (l) { bySlot[l.slot] = l; });

        return srcLines.reduce(function (chain, l, i) {
          return chain.then(function () {
            return DB.byIndex('kit_line_parts', 'kit_line_id', l.id).then(function (srcLinks) {
              var target = bySlot[l.slot];
              if (!target) {
                return DB.put('kit_lines', { kit_id: kitId, slot: l.slot, qty: l.qty || 1,
                                             sort: mine.length + i, use_count: 0, notes: null })
                  .then(function (newLineId) {
                    made += 1;
                    return copyLinks(l.id, newLineId).then(function (n) { filled += n; });
                  });
              }
              if (!srcLinks.length) return null;
              // Only fill a position that is still empty; never overwrite.
              return DB.byIndex('kit_line_parts', 'kit_line_id', target.id).then(function (existing) {
                if (existing.length) return null;
                return copyLinks(l.id, target.id).then(function (n) { filled += n; });
              });
            });
          });
        }, Promise.resolve());
      });
    }).then(function () {
      if (!made && !filled) toast('Nothing new to copy.');
      else toast('Copied ' + plural(filled, 'part number') +
                 (made ? ' and ' + plural(made, 'new position') : ''));
      go('#/kit/' + kitId);
    }).catch(fail);
  };

  // --------------------------------------------------------------- router
  function route() {
    var hash = location.hash.slice(1) || '/';
    var p = hash.split('/').filter(function (s) { return s !== ''; });
    var run;
    if (!p.length)                 run = UI.screenBrands();
    else if (p[0] === 'brand')     run = UI.screenBrand(decodeURIComponent(p[1] || ''));
    else if (p[0] === 'model')     run = UI.screenModel(decodeURIComponent(p[1] || ''));
    else if (p[0] === 'kit')       run = UI.screenKit(p[1]);
    else if (p[0] === 'part')      run = UI2.screenPart(p[1], p[2]);
    else if (p[0] === 'search')    run = UI2.screenSearch();
    else if (p[0] === 'cleanup')   run = screenCleanup();
    else if (p[0] === 'editmodel') run = screenEditModel(p[1]);
    else if (p[0] === 'backup')    run = screenBackup();
    else if (p[0] === 'menu')      run = screenMenu();
    else if (p[0] === 'copy')      run = screenCopy(p[1]);
    else                           run = UI.screenBrands();
    Promise.resolve(run).catch(fail);
  }

  window.addEventListener('hashchange', route);
  document.getElementById('back').addEventListener('click', function () { history.back(); });
  document.getElementById('menu').addEventListener('click', function () { go('#/menu'); });

  // ----------------------------------------------------------------- init
  var SIZE_KEY = 'dms-parts-size';
  function currentSize() {
    try { return localStorage.getItem(SIZE_KEY) || 1; } catch (e) { return 1; }
  }
  function applySize(n) {
    document.documentElement.className = 'size-' + n;
    // The control only exists on the menu screen, so this is a no-op elsewhere.
    Array.prototype.forEach.call(document.querySelectorAll('.sizebtns button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-size') === String(n)));
    });
    try { localStorage.setItem(SIZE_KEY, n); } catch (e) {}
  }
  app.addEventListener('click', function (e) {
    var b = e.target.closest('.sizebtns button');
    if (b) applySize(b.getAttribute('data-size'));
  });
  applySize(currentSize());

  function setOnline() {
    document.body.classList.toggle('offline', !navigator.onLine);
  }
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
  setOnline();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('service worker did not register:', e);
      });
    });
  }

  render('<p class="empty">Getting the machine list ready&hellip;</p>');
  Seed.ensure(function (msg) { render('<p class="empty">' + esc(msg) + '</p>'); })
    .then(route)
    .catch(function (e) {
      // A failed seed must not leave a blank app — anything already stored
      // still works offline.
      console.error(e);
      DB.count('models').then(function (n) {
        if (n) { route(); toast('Could not check for updates.'); }
        else { fail(e); }
      }).catch(function () { fail(e); });
    });

  window.route = route;
})();
