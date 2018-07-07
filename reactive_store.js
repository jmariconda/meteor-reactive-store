import { Tracker } from 'meteor/tracker';

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

const specialEqChecks = {
    Set(oldSet, newSet) {
        let equal = (newSet instanceof Set && newSet.size === oldSet.size);

        if (equal) {
            for (const val of oldSet.values()) {
                if (!newSet.has(val)) {
                    equal = false;
                    break;
                }
            }
        }

        return equal;
    },
    Date(oldDate, newDate) {
        return (newDate instanceof Date && oldDate.getTime() === newDate.getTime());
    }
};

export default class ReactiveStore {
    constructor(initData) {
        this._isObjectOrArray = isObject(initData) || Array.isArray(initData);
        this._deps = {};
        
        ensureDepNode(this._deps, 'root', true);
        
        this._rootDep = this._deps.root.dep;
        this._pathDeps = this._deps.root.subDeps;
        
        this.data = initData;
    }

    get(path, options) {
        const reactive = (!options || options.reactive) && Tracker.active;

        let search = this.data,
            validPath = true;

        if (isNonEmptyString(path)) {
            const pathTokens = path.split('.');

            let deps = this._pathDeps;

            for (let i = 0, numTokens = pathTokens.length; i < numTokens; i++) {
                const tokenName = pathTokens[i];

                if (reactive) {
                    const depNode = ensureDepNode(deps, tokenName, (i === numTokens - 1));

                    if (depNode.dep) {
                        depNode.dep.depend();
                    }
                    
                    deps = depNode.subDeps;
                }

                if (validPath) {
                    if (isObject(search) || Array.isArray(search)) {
                        search = search[tokenName];

                    } else if (reactive) {
                        validPath = false;

                    } else {
                        return;
                    }
                }
            }

        } else if (reactive) {
            this._rootDep.depend();
        }

        if (validPath) return search;
    }

    set(value) {
        const wasObjectOrArray = this._isObjectOrArray,
            oldValue = this.data;
        
        this._isObjectOrArray = isObject(value) || Array.isArray(value);
        this.data = value;

        if (wasObjectOrArray) {
            // Old root value was previously an Object/Array: check for deep dependency changes
            this._triggerChangedDeps(this._deps.root, oldValue, value);
            
        } else {
            // If new value is an Object/Array, trigger all existing deps that are set in it
            if (this._isObjectOrArray) {
                this._triggerAllDeps(this._pathDeps, value);
            }

            // Trigger root dep if values are not equal or they both reference the same class instance and, either there is no special equality check, or they do not pass it
            if (oldValue !== value || (typeof oldValue === 'object' && (!specialEqChecks[oldValue.constructor.name] || !specialEqChecks[oldValue.constructor.name](oldValue, value)))) {
                this._triggerDep(this._rootDep);
            }
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
            this._triggeredDepSet = new Set();

            for (const path of Object.keys(dataOrPath)) {
                this._setAtPath(path, dataOrPath[path]);
            }

            delete this._triggeredDepSet;

        } else {
            // dataOrPath is a single path to assign
            this._setAtPath(dataOrPath, value);
        }
    }
    
    // Iterate through valid paths and unset values
    delete(...paths) {
        // Only run if root data is an Object or Array and paths are available
        if (!this._isObjectOrArray) return;

        this._triggeredDepSet = new Set();

        for (const path of paths) {
            this._setAtPath(path, null, { unset: true });
        }

        delete this._triggeredDepSet;
    }

    // Reset root data based on current type
    clear() {
        if (this._isObjectOrArray) {
            // If root data is an Object or Array, reset it to empty Object/Array respectively
            this.set((this.data.constructor === Object) ? {} : []);
        } else {
            // Otherwise, reset root data to undefined
            this.set(undefined);   
        }
    }

    _setAtPath(path, value, options = {}) {
        const pathSplit = path.split('.'),
            parentDeps = [];

        let deps = this._pathDeps,
            search = this.data;           
            
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
                            if (oldValue) {
                                this._triggerAllDeps(deps[pathToken].subDeps, oldValue);
                            }

                            this._triggerDep(deps[pathToken].dep);
                        }
        
                    } else {
                        // Otherwise, set the new value
                        search[pathToken] = value;
        
                        // Starting with current dep, traverse down and trigger any deps for changed vals
                        changed = this._triggerChangedDeps((deps ? deps[pathToken] : false), oldValue, value);
                    }
        
                    if (changed || !keyExists) {
                        // Trigger any active parent dependencies that were hit (in reverse order to keep dependency trigger order bottom-up)
                        for (let i = parentDeps.length - 1; i >= 0; i--) {
                            this._triggerDep(parentDeps[i]);
                        }
                        
                        this._triggerDep(this._rootDep);
                    }
                }
            }
        }
    }

    _triggerDep(dep) {
        if (dep) {
            if (this._triggeredDepSet) {
                if (this._triggeredDepSet.has(dep)) return;

                this._triggeredDepSet.add(dep);
            }

            dep.changed();
        }
    }
    
    _triggerAllDeps(deps, inObjectOrArray) {
        if (deps && (inObjectOrArray === undefined || isObject(inObjectOrArray) || Array.isArray(inObjectOrArray))) {
            for (const key of Object.keys(deps)) {
                if (!inObjectOrArray || inObjectOrArray.hasOwnProperty(key)) {
                    let inObjectOrArrayAtKey;
                    
                    if (inObjectOrArray) {
                        inObjectOrArrayAtKey = inObjectOrArray[key] || null;
                    }
    
                    this._triggerAllDeps(deps[key].subDeps, inObjectOrArrayAtKey);
                    this._triggerDep(deps[key].dep);
                }
            }
    
            return true;
        }
    }
    
    _triggerChangedDeps(depNode, oldValue, newValue) {
        const subDeps = depNode ? depNode.subDeps : false,
            newValueIsObjectOrArray = isObject(newValue) || Array.isArray(newValue);

        let searchedForChangedSubDeps = false,
            changed = false;
    
        if (typeof oldValue === 'object' && oldValue !== null) {
            if (oldValue !== newValue) {
                const oldConstructor = oldValue.constructor;
    
                if (oldConstructor === Object || oldConstructor === Array) {
                    // If oldValue is an Object or Array, iterate through its keys/vals and recursively trigger subDeps
                    const keys = new Set(Object.keys(oldValue));

                    if (newValueIsObjectOrArray) {
                        const newValueKeys = Object.keys(newValue);

                        changed = (keys.size !== newValueKeys.length);

                        for (const subKey of newValueKeys) {
                            keys.add(subKey);
                        }

                    } else {
                        changed = true;
                    }

                    if (keys.size) {
                        // If the old Object/Array was not empty, iterate through its keys and check for deep changes
                        for (const subKey of keys.values()) {
                            const subDepNode = subDeps ? subDeps[subKey] : false;

                            // If we already know that oldValue has changed, only keep traversing if there are unchecked sub-dependencies
                            if (changed) {
                                if (!subDeps) break;
                                if (!subDepNode) continue;
                            }
                            
                            changed = (this._triggerChangedDeps(subDepNode, oldValue[subKey], (newValueIsObjectOrArray ? newValue[subKey] : undefined)) || changed);
                            searchedForChangedSubDeps = true;
                        }
                    }
                    
                } else {
                    // If there is a special-case equality check for the oldValue's instance type (e.g. Set, Date, etc), run that
                    changed = !specialEqChecks[oldConstructor.name] || !specialEqChecks[oldConstructor.name](oldValue, newValue);
                }

            } else {
                // If oldValue and newValue share a reference, there is no reliable way to check for changes because keys could have been modified.
                // In this case, we assume the value has changed in some way.
                changed = true;
            }

        } else {
            // For primitives or null, just perform basic equivalency check
            changed = (oldValue !== newValue);
        }

        if (newValueIsObjectOrArray && !searchedForChangedSubDeps) {
            this._triggerAllDeps(subDeps, newValue);
        }
        
        if (changed && depNode) {
            this._triggerDep(depNode.dep);
        }
    
        return changed;
    }
}

ReactiveStore.addEqualityCheck = function (constructor, eqCheck) {
    if (typeof constructor !== 'function' || typeof eqCheck !== 'function' || eqCheck.length !== 2) {
        throw new Error('You must provide a valid constructor function/class and an equality check function that takes two parameters (oldValue, newValue).');
    }

    specialEqChecks[constructor.name] = eqCheck;
};
