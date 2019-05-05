export function isObject(val) {
    return (val instanceof Object && val.constructor === Object);
}

export function isTraversable(val) {
    return (isObject(val) || Array.isArray(val));
}

export function ensureDepNode(deps, key) {
    if (!deps[key]) {
        deps[key] = { subDeps: {} };
    }

    return deps[key];
}
