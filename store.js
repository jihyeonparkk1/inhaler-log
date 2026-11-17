// IndexedDB: 기록은 이 휴대폰 안에만 저장된다.
const DB_NAME = "inhaler-log";
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("events")) d.createObjectStore("events", { keyPath: "id" });
      if (!d.objectStoreNames.contains("daily")) d.createObjectStore("daily", { keyPath: "key" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const req = fn(s);
    if (req && typeof req === "object" && "onsuccess" in req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const store = {
  all: name => run(name, "readonly", s => s.getAll()),
  get: (name, key) => run(name, "readonly", s => s.get(key)),
  put: (name, value, key) => run(name, "readwrite", s => (key === undefined ? s.put(value) : s.put(value, key))),
  putMany: (name, values) => run(name, "readwrite", s => { values.forEach(v => s.put(v)); }),
  del: (name, key) => run(name, "readwrite", s => s.delete(key)),
};
