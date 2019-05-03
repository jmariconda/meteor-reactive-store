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

    // If current value is an instantiated type, just store it as the Object constructor
    depNode.curValue = (curValue instanceof Object) ? Object : curValue;

    let eqDep = depNode.eqDepMap.get(depValue);

    if (!eqDep) {
        eqDep = new Tracker.Dependency();
        eqDep.wasEqual = (depNode.curValue === depValue);
        depNode.eqDepMap.set(depValue, eqDep);
    }
    
    return eqDep;
}

export function ensureDepNode(deps, key) {
    if (!deps[key]) {
        deps[key] = { subDeps: {} };
    }

    return deps[key];
}
