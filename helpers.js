import { SHALLOW, DELETE } from './symbols';

const SpacebarsKw = Package.spacebars && Package.spacebars.Spacebars.kw;

export function isObject(val) {
    return (val instanceof Object && val.constructor === Object);
}

export function isSpacebarsKw(val) {
    return (SpacebarsKw) ? (val instanceof SpacebarsKw) : false;
}

// Returns true if the given value is traversable (is Object/Array and doesn't have SHALLOW as a key set to a truthy value)
export function isTraversable(value) {
    return (isObject(value) || Array.isArray(value)) && !value[SHALLOW];
}

export function useStrictEqualityCheck(val) {
    // NOTE: Functions and (polyfilled) Symbols are technically Objects, but should be treated as primitives for equality checks
    return !(val instanceof Object) || (val instanceof Function) || (val instanceof Symbol);
}

export function ensureDepNode(deps, key) {
    if (!deps[key]) {
        deps[key] = { subDeps: {} };
    }

    return deps[key];
}

export function setsAreEqual(setA, setB) {
    let equal = (
        setA instanceof Set
        && setB instanceof Set
        && setA.size === setB.size
    );

    if (equal) {
        for (const val of setA) {
            if (!setB.has(val)) {
                equal = false;
                break;
            }
        }
    }

    return equal;
}

// Return obj[key] if obj is traversable and key is an enumerable property within it; otherwise, return DELETE to indicate nonexistant value
export function valueAtKey(obj, key) {
    const keyExists = (isTraversable(obj) && obj.propertyIsEnumerable(key));
    return keyExists ? obj[key] : DELETE;
}
