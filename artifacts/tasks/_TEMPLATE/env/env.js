globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.global = globalThis;

globalThis.location ??= {href: ''};
globalThis.history ??= {};
globalThis.screen ??= {};
globalThis.canvas ??= {};
globalThis.document ??= {cookie: '', location: globalThis.location};
globalThis.navigator ??= {userAgent: 'js-reverse-mcp'};

globalThis.atob ??= (value) => Buffer.from(String(value), 'base64').toString('utf8');
globalThis.btoa ??= (value) => Buffer.from(String(value), 'utf8').toString('base64');
globalThis.crypto ??= {subtle: {}};

globalThis.localStorage ??= {
  _store: new Map(),
  getItem(key) {
    const normalized = String(key);
    return this._store.has(normalized) ? this._store.get(normalized) : null;
  },
  setItem(key, value) {
    this._store.set(String(key), String(value));
  },
  removeItem(key) {
    this._store.delete(String(key));
  },
  clear() {
    this._store.clear();
  },
  key(index) {
    return Array.from(this._store.keys())[index] ?? null;
  },
  get length() {
    return this._store.size;
  },
};

globalThis.sessionStorage ??= {
  _store: new Map(),
  getItem(key) {
    const normalized = String(key);
    return this._store.has(normalized) ? this._store.get(normalized) : null;
  },
  setItem(key, value) {
    this._store.set(String(key), String(value));
  },
  removeItem(key) {
    this._store.delete(String(key));
  },
  clear() {
    this._store.clear();
  },
  key(index) {
    return Array.from(this._store.keys())[index] ?? null;
  },
  get length() {
    return this._store.size;
  },
};
