import { Tracker } from 'meteor/tracker';

export function isObject(val) {
    return (val instanceof Object && val.constructor === Object);
}

export function isTraversable(val) {
    return (isObject(val) || Array.isArray(val));
}

export function ensureDep(depNode) {
    if (!depNode.dep) {
        depNode.dep = new Tracker.Dependency();
    }

    return depNode.dep;
}

export function ensureEqDep(depNode, depValue, curValue) {
    if (!depNode.eqDepMap) {
        depNode.eqDepMap = new Map();
    }

    let eqDep = depNode.eqDepMap.get(depValue);

    if (!eqDep) {
        eqDep = new Tracker.Dependency();
        depNode.eqDepMap.set(depValue, eqDep);
    }

    if (curValue === depValue) {
        depNode.activeEqDep = eqDep;
    }
    
    return eqDep;
}

export function ensureDepNode(deps, key) {
    if (!deps[key]) {
        deps[key] = { subDeps: {} };
    }

    return deps[key];
}
