export function isObject(val) {
    return (val instanceof Object && val.constructor === Object);
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
