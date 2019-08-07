export function isObject(val) {
    return (val instanceof Object && val.constructor === Object);
}

const SpacebarsKw = Package.spacebars && Package.spacebars.Spacebars.kw;

export function isSpacebarsKw(val) {
    return (SpacebarsKw) ? (val instanceof SpacebarsKw) : false;
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
