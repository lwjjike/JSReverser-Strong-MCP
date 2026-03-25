
export const NATIVE_PROTECT_STRING = `
if (!window.NativeProtect) {
    class NativeProtect {
        #map = new Map();
        static #instance = null;

        static getInstance() {
            if (!NativeProtect.#instance) {
                NativeProtect.#instance = new NativeProtect();
                var _toString = Function.prototype.toString;
                var patchedToString = {
                    toString() {
                        if (NativeProtect.#instance.#map.has(this)) {
                            var name = NativeProtect.#instance.#map.get(this);
                            return "function "+ (name || this.name) +"() { [native code] }";
                        } else {
                            return _toString.call(this);
                        }
                    }
                }.toString;
                Object.defineProperty(Function.prototype, "toString", {
                    value: patchedToString,
                    writable: true,
                    enumerable: false,
                    configurable: true,
                })
                this.#instance.#map.set(Function.prototype.toString, "toString");
            }
            return NativeProtect.#instance;
        }

        constructor() {
            if (NativeProtect.#instance) {
                throw new Error("NativeProtect类只能实例化一次");
            }
        }

        setNativeFunc(func, name = "") {
            this.#map.set(func, name);
        }
    }
    window.NativeProtect = NativeProtect;
}
`;

export const LOGGER_INFO_STRING = `
if (!window.logger) {
    window.logger = {
        info: console.log,
    };
}
`;

export function getStringArray(str: string) {
    return str.split('\n');
}

export function getToStringProtectCode(funcStr: string, funcName?: string) {
    return `window.NativeProtect?.getInstance()?.setNativeFunc(${funcStr}${funcName ? `, "${funcName}"` : ""});`;
}

export function printString(str: string) {
    return `window.logger?.info(${str});`;
}

export function getDescStr(target: string, name: string, desc: { value?: number | string, writable?: boolean, enumerable?: boolean, configurable?: boolean }) {
    return `Object.defineProperty(${target}, "${name}", {
        value: ${typeof desc.value === 'string' ? `"${desc.value}"` : desc.value},
        writable: ${desc.writable},
        enumerable: ${desc.enumerable},
        configurable: ${desc.configurable},
    });`
}