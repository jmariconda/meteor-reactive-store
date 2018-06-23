function isObject(val) {
    return val && typeof val === 'object' && val.constructor === Object;
}

function isNonEmptyString(val) {
    return val && typeof val === 'string';
}

function ensureDepNode(deps, key, initDep) {
    if (!deps[key]) {
        deps[key] = { subDeps: {} };
    }

    if (initDep && !deps[key].dep) {
        deps[key].dep = new Tracker.Dependency();
    }

    return deps[key];
}

function triggerDep(dep) {
    if (dep) dep.changed();
}

function triggerAllDeps(deps, inObjectOrArray) {
    if (deps && (inObjectOrArray === undefined || isObject(inObjectOrArray) || Array.isArray(inObjectOrArray))) {
        for (const key of Object.keys(deps)) {
            if (!inObjectOrArray || inObjectOrArray.hasOwnProperty(key)) {
                let inObjectOrArrayAtKey;
                
                if (inObjectOrArray) {
                    inObjectOrArrayAtKey = inObjectOrArray[key] || null;
                }

                triggerDep(deps[key].dep);
                triggerAllDeps(deps[key].subDeps, inObjectOrArrayAtKey);
            }
        }

        return true;
    }
}

function triggerChangedDeps(deps, key, oldValue, newValue) {
    const depNode = deps && deps[key];

    let changed = false;

    if (typeof oldValue === 'object' && oldValue !== null) {
        const wasObject = (oldValue.constructor === Object),
            wasArray = (oldValue.constructor === Array),
            subDeps = (depNode && depNode.subDeps);

        if (wasObject || wasArray) {
            // If oldValue is an Object or Array, iterate through its keys/vals and recursively trigger subDeps
            if (oldValue !== newValue) {
                // If newValue references a different object, assume that the old reference has not been modified and check for deep changes.
                if (wasObject && !isObject(newValue)) {
                    newValue = {};
                } else if (wasArray && !Array.isArray(newValue)) {
                    newValue = [];
                }

                const oldKeys = Object.keys(oldValue);

                if (oldKeys.length) {
                    for (const subKey of oldKeys) {
                        if (triggerChangedDeps(subDeps, subKey, oldValue[subKey], newValue[subKey])) {
                            changed = true;
                        }
                    }

                } else {
                    triggerAllDeps(subDeps, newValue);
                    changed = true;
                }
                
            } else {
                // If oldValue and newValue share a reference, there is no reliable way to check for changes because keys could have been modified.
                // In this case, we just trigger the current dep and all subDeps to be safe.
                triggerAllDeps(subDeps);
                changed = true;
            }

        } else {
            // If none of the above match, we must assume it has changed for lack of a better way to check
            changed = true;
        }

    } else {
        // For primitives or null, just perform basic equivalency check
        changed = oldValue !== newValue;
    }
    
    if (changed && depNode) {
        triggerDep(depNode.dep);
    }

    return changed;
}

export default class ReactiveStore {
    constructor(initData /* , equalsFunc */) {
        this._isObjectOrArray = isObject(initData) || Array.isArray(initData);
        // this._equalsFunc = (typeof equalsFunc === 'function') ? equalsFunc : null;
        this._deps = {};
        
        ensureDepNode(this._deps, 'root', true);
        
        this._rootDep = this._deps.root.dep;
        this._pathDeps = this._deps.root.subDeps;
        
        this.data = initData;
    }

    get(path) {
        let search = this.data,
            found = true;

        if (isNonEmptyString(path)) {
            const pathTokens = path.split('.');

            let deps = this._pathDeps;

            for (let i = 0, numTokens = pathTokens.length; i < numTokens; i++) {
                const tokenName = pathTokens[i];

                if (Tracker.active) {
                    const depNode = ensureDepNode(deps, tokenName, (i === numTokens - 1));

                    if (depNode.dep) {
                        depNode.dep.depend();
                    }
                    
                    deps = depNode.subDeps;
                }

                if (!found) continue;

                if (isObject(search) || Array.isArray(search)) {
                    search = search[tokenName];
                } else {
                    found = false;
                }
            }

        } else if (Tracker.active) {
            this._rootDep.depend();
        }

        if (found) {
            return search;
        }
    }

    set(value) {
        const wasObjectOrArray = this._isObjectOrArray,
            oldValue = this.data;
        
        this._isObjectOrArray = isObject(value) || Array.isArray(value);
        this.data = value;

        // if (this._equalsFunc) {
        //     if (!this._equalsFunc(oldValue, value)) {
        //         triggerAllDeps(this._deps);
        //     }

        // } else if (wasObjectOrArray) {
        if (wasObjectOrArray) {
            triggerChangedDeps(this._deps, 'root', oldValue, value);
            
        } else if (typeof oldValue === 'object' || oldValue !== value) {
            if (this._isObjectOrArray) {
                triggerAllDeps(this._pathDeps, value);
            }
            
            this._rootDep.changed();
        }
    }

    assign(dataOrPath, value) {
        if (!dataOrPath) return;

        // Coerce root data to be an Object if it is not currenty an Object or Array
        if (!this._isObjectOrArray) {
            this._isObjectOrArray = true;
            this.data = {};
        }

        if (isObject(dataOrPath)) {
            // dataOrPath is Object of paths assigned to values
            for (const path of Object.keys(dataOrPath)) {
                this._setAtPath(path, dataOrPath[path]);
            }

        } else if (isNonEmptyString(dataOrPath)) {
            // dataOrPath is a single path to assign
            this._setAtPath(dataOrPath, value);
        }
    }
    
    delete(...paths) {
        if (this._isObjectOrArray) {
            // Only take paths into account if root value is an Object or Array
            if (paths.length) {
                // Iterate through valid paths and unset values
                for (const path of paths) {
                    if (isNonEmptyString(path)) {
                        this._setAtPath(path, null, { unset: true });
                    }
                }

            } else {
                // If no paths are provided, reset root value to empty Object/Array
                this.set((this.data.constructor === Object) ? {} : []);
            }

        } else {
            // If no paths are provided, reset root value to undefined
            this.set(undefined);   
        }
    }

    _setAtPath(path, value, options = {}) {
        const pathSplit = path.split('.'),
            parentDeps = [];

        let search = this.data,
            deps = this._pathDeps;
            
        for (let pathIdx = 0, numTokens = pathSplit.length; pathIdx < numTokens; pathIdx++) {
            const pathToken = pathSplit[pathIdx];
            
            if (pathIdx < numTokens - 1) {
                // Parent Token: Ensure that search[pathToken] is a valid Object or Array, step into it, and store active deps
                if (!isObject(search[pathToken]) && !Array.isArray(search[pathToken])) {
                    search[pathToken] = {};
                }

                search = search[pathToken];

                if (deps) {
                    if (deps[pathToken]) {
                        // If parent node has dependency, store it so it can be triggered after we know that 
                        // the targeted child property has definitely changed
                        if (deps[pathToken].dep) {
                            parentDeps.push(deps[pathToken].dep);
                        }
                        
                        deps = deps[pathToken].subDeps;

                    } else {
                        deps = null;
                    }
                }

            } else {
                // Last Token: Set/Unset search at pathToken and handle dep changes
                const keyExists = search.hasOwnProperty(pathToken);

                if (!options.unset || keyExists) {
                    const oldValue = search[pathToken];

                    let changed = true;
        
                    if (options.unset) {
                        // Delete pathToken if unset
                        delete search[pathToken];
        
                        // Trigger dep at pathToken and any subDeps it may have
                        if (deps && deps[pathToken]) {
                            triggerDep(deps[pathToken].dep);

                            if (oldValue) {
                                triggerAllDeps(deps[pathToken].subDeps, oldValue);
                            }
                        }
        
                    } else {
                        // Otherwise, set the new value
                        search[pathToken] = value;
        
                        // Starting with current dep, traverse down and trigger any deps for changed vals
                        changed = triggerChangedDeps(deps, pathToken, oldValue, value);
                    }
        
                    if (changed || !keyExists) {
                        // Trigger any active parent dependencies that were hit (in reverse order to keep dependency trigger order bottom-up)
                        for (let i = parentDeps.length - 1; i >= 0; i--) {
                            parentDeps[i].changed();
                        }

                        this._rootDep.changed();
                    }
                }
            }
        }
    }
}
