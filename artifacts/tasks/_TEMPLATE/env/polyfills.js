const originLog = console.log.bind(console);
const nativeMark = Symbol('native_code_mark');

globalThis.console_log = (...args) => originLog(...args);

function setNative(fn, key, value) {
  Object.defineProperty(fn, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function installSafeFunction() {
  const rawToString = Function.prototype.toString;

  function patchedToString() {
    return typeof this === 'function' && this[nativeMark]
      ? this[nativeMark]
      : rawToString.call(this);
  }

  Object.defineProperty(Function.prototype, 'toString', {
    value: patchedToString,
    writable: true,
    configurable: true,
  });

  setNative(Function.prototype.toString, nativeMark, 'function toString() { [native code] }');
}

globalThis.safeFunction = (fn) => {
  setNative(fn, nativeMark, `function ${fn.name || ''}() { [native code] }`);
  return fn;
};

function shouldIgnoreProp(prop) {
  const text = typeof prop === 'symbol' ? String(prop) : String(prop);
  return [
    'Math',
    'Symbol',
    'Proxy',
    'Promise',
    'Array',
    'isNaN',
    'encodeURI',
    'Uint8Array',
  ].includes(text) || text.includes('Symbol(');
}

globalThis.watch = function watch(obj, name) {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (!shouldIgnoreProp(prop)) {
        globalThis.console_log('[env:get]', `${name}.${String(prop)}`, typeof val === 'function' ? 'function' : val);
      }
      return val;
    },
    set(target, prop, value, receiver) {
      const ok = Reflect.set(target, prop, value, receiver);
      globalThis.console_log('[env:set]', `${name}.${String(prop)}`, typeof value === 'function' ? 'function' : value);
      return ok;
    },
    has(target, key) {
      globalThis.console_log('[env:has]', `${name}.${String(key)}`);
      return key in target;
    },
    ownKeys(target) {
      globalThis.console_log('[env:ownKeys]', name);
      return Reflect.ownKeys(target);
    },
  });
};

globalThis.makeFunction = function makeFunction(name) {
  const fn = new Function(`
    return function ${name}() {
      globalThis.console_log("[env:call]", "${name}", Array.from(arguments));
    }
  `)();
  globalThis.safeFunction(fn);
  fn.prototype = globalThis.watch(fn.prototype, `${name}.prototype`);
  return globalThis.watch(fn, name);
};

function wrapGlobalObject(name) {
  const value = globalThis[name];
  const wrapped = globalThis.watch(value, name);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!descriptor || descriptor.writable || descriptor.set) {
    globalThis[name] = wrapped;
    return;
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    writable: true,
    value: wrapped,
  });
}

installSafeFunction();

wrapGlobalObject('window');
wrapGlobalObject('document');
wrapGlobalObject('navigator');
wrapGlobalObject('localStorage');
wrapGlobalObject('sessionStorage');
wrapGlobalObject('location');
wrapGlobalObject('history');
wrapGlobalObject('screen');
