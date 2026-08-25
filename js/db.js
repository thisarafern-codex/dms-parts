/* Minimal promise wrapper over IndexedDB. No dependency, no build step.
   The phone's IndexedDB is the source of truth for everything dad types. */
(function (global) {
  'use strict';

  var NAME = 'dms-parts';
  var VERSION = 1;
  var _db = null;

  // store -> { keyPath, indexes: { name: [keyPath, unique] } }
  var SCHEMA = {
    brands:         { indexes: { name: ['name', true] } },
    models:         { indexes: { key: ['key', true], brand: ['brand', false] } },
    kits:           { indexes: { model_id: ['model_id', false] } },
    kit_lines:      { indexes: { kit_id: ['kit_id', false] } },
    parts:          { indexes: { number_key: ['number_key', true] } },
    kit_line_parts: { indexes: { kit_line_id: ['kit_line_id', false],
                                 part_id: ['part_id', false] } },
    clients:        { indexes: {} },
    machines:       { indexes: { model_key: ['model_key', false] } },
    meta:           { keyPath: 'k', indexes: {} }
  };

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        Object.keys(SCHEMA).forEach(function (name) {
          var spec = SCHEMA[name];
          var store = db.objectStoreNames.contains(name)
            ? e.target.transaction.objectStore(name)
            : db.createObjectStore(name, spec.keyPath
                ? { keyPath: spec.keyPath }
                : { keyPath: 'id', autoIncrement: true });
          Object.keys(spec.indexes).forEach(function (idx) {
            if (!store.indexNames.contains(idx)) {
              store.createIndex(idx, spec.indexes[idx][0], { unique: spec.indexes[idx][1] });
            }
          });
        });
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(stores, mode) {
    return open().then(function (db) {
      return db.transaction(stores, mode || 'readonly');
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function get(store, key) {
    return tx([store]).then(function (t) { return wrap(t.objectStore(store).get(key)); });
  }

  function all(store) {
    return tx([store]).then(function (t) { return wrap(t.objectStore(store).getAll()); });
  }

  function byIndex(store, index, value) {
    return tx([store]).then(function (t) {
      return wrap(t.objectStore(store).index(index).getAll(value));
    });
  }

  function oneByIndex(store, index, value) {
    return tx([store]).then(function (t) {
      return wrap(t.objectStore(store).index(index).get(value));
    });
  }

  function put(store, value) {
    return tx([store], 'readwrite').then(function (t) {
      var p = wrap(t.objectStore(store).put(value));
      return done(t).then(function () { return p; });
    });
  }

  function del(store, key) {
    return tx([store], 'readwrite').then(function (t) {
      var p = wrap(t.objectStore(store).delete(key));
      return done(t).then(function () { return p; });
    });
  }

  function clear(stores) {
    return tx(stores, 'readwrite').then(function (t) {
      stores.forEach(function (s) { t.objectStore(s).clear(); });
      return done(t);
    });
  }

  /* Bulk insert inside ONE transaction. Seeding writes a few thousand rows and
     a transaction per row would take seconds on a phone. */
  function bulk(store, rows, assignId) {
    if (!rows.length) return Promise.resolve([]);
    return tx([store], 'readwrite').then(function (t) {
      var os = t.objectStore(store), ids = [];
      rows.forEach(function (row, i) {
        var req = os.put(row);
        req.onsuccess = function () {
          ids[i] = req.result;
          if (assignId) assignId(row, req.result);
        };
      });
      return done(t).then(function () { return ids; });
    });
  }

  function done(t) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
    });
  }

  function count(store) {
    return tx([store]).then(function (t) { return wrap(t.objectStore(store).count()); });
  }

  function meta(k, v) {
    if (arguments.length === 1) {
      return get('meta', k).then(function (r) { return r ? r.v : null; });
    }
    return put('meta', { k: k, v: v });
  }

  global.DB = {
    open: open, get: get, all: all, byIndex: byIndex, oneByIndex: oneByIndex,
    put: put, del: del, clear: clear, bulk: bulk, count: count, meta: meta,
    tx: tx, wrap: wrap, done: done, STORES: Object.keys(SCHEMA)
  };
})(window);
