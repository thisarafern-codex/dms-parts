/* Export / import everything as one JSON file.

   The phone's IndexedDB is the ONLY copy of every part number dad types, so
   this is not a nice-to-have: a lost or wiped phone must not mean lost work. */
(function (global) {
  'use strict';

  var STORES = ['brands', 'models', 'kits', 'kit_lines', 'parts',
                'kit_line_parts', 'clients', 'machines', 'meta'];

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

  global.Backup = { exportAll: exportAll, download: download,
                    importAll: importAll, readFile: readFile };
})(window);
