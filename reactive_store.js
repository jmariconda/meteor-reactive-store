import { Tracker } from 'meteor/tracker';
import { Spacebars } from 'meteor/spacebars';

function isObject(val) {
    return (val instanceof Object && val.constructor === Object);
}

function ensureDep(depNode) {
    if (!depNode.dep) {
        depNode.dep = new Tracker.Dependency();
    }

    return depNode.dep;
}

function ensureDepNode(deps, key) {
    if (!deps[key]) {
        deps[key] = { subDeps: {} };
    }

    return deps[key];
}

const customEqChecks = {
    Set(oldSet, newSet) {
        let equal = (newSet instanceof Set && newSet.size === oldSet.size);

        if (equal) {
            for (const val of oldSet) {
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
    constructor(data, mutators) {
        this._isObjectOrArray = isObject(data) || Array.isArray(data);
        this._mutators = isObject(mutators) ? mutators : {};
        this._deps = {};
        this._rootNode = ensureDepNode(this._deps, 'root');
        
        this.data = data;
    }

    // Add custom equality check for instances of the given constuctor
    static addEqualityCheck(constructor, eqCheck) {
        if (!(constructor instanceof Function) || !(eqCheck instanceof Function) || eqCheck.length !== 2) {
            throw new Error('You must provide a valid constructor function/class and an equality check function that takes two parameters (oldValue, newValue).');
        }

        customEqChecks[constructor.name] = eqCheck;
    }

    // Remove custom equality check for instances of the given constuctor
    static removeEqualityCheck(constructor) {
        if (!(constructor instanceof Function)) {
            throw new Error('You must provide a valid constructor function/class.');
        }

        delete customEqChecks[constructor.name];
    }

    // Global Symbol that can be assigned to path to delete it from the store
    static DELETE = Symbol('DELETE_PATH');

    // Get value at path register reactive dependency if reactive
    get(path, options) {
        if (isObject(path) || (path instanceof Spacebars.kw)) {
            // Assume first param is options object if it is an Object or Spacebars.kw 
            options = (path instanceof Spacebars.kw) ? path.hash : path;
            path = null;

        } else if (options instanceof Spacebars.kw) {
            // Use the internal hash object if options is a Spacebars.kw instance
            options = options.hash;

        } else if (!isObject(options)) {
            // Otherwise, set options to {} if it is not an Object
            options = {};
        }

        // Set default option values if they are not set
        if (!options.hasOwnProperty('reactive')) {
            options.reactive = true;
        }

        const reactive = (Tracker.active && options.reactive);

        let search = this.data,
            validPath = true;

        if (path && path.constructor === String) {
            // Search down path for value while tracking dependencies (if reactive)
            const pathTokens = path.split('.');

            let deps = this._rootNode.subDeps;

            for (let i = 0, numTokens = pathTokens.length; i < numTokens; i++) {
                const tokenName = pathTokens[i];

                if (reactive) {
                    const isLastToken = (i === numTokens - 1),
                        depNode = ensureDepNode(deps, tokenName);

                    if (isLastToken) {
                        ensureDep(depNode).depend();
                    }
                    
                    deps = depNode.subDeps;
                }

                if (validPath) {
                    if (isObject(search) || Array.isArray(search)) {
                        search = search[tokenName];
                    } else {
                        validPath = false;
                        if (!reactive) break;
                    }
                }
            }

        } else if (reactive) {
            // Otherwise track the root dependency (if reactive)
            ensureDep(this._rootNode).depend();
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
            this._triggerChangedDeps(this._rootNode, oldValue, value);
            
        } else {
            // If new value is an Object/Array, trigger all existing deps that are set in it
            if (this._isObjectOrArray) {
                this._triggerAllDeps(this._rootNode.subDeps, value);
            }

            // Trigger root dep if values are not equal or they both reference the same instance and, either there is no custom equality check, or they do not pass it
            if (
                (oldValue !== value)
                || (
                    (oldValue instanceof Object)
                    && (
                        !customEqChecks[oldValue.constructor.name]
                        || !customEqChecks[oldValue.constructor.name](oldValue, value)
                    )
                )
            ) {
                this._triggerDep(this._rootNode.dep);
            }
        }
    }

    assign(pathOrMap, value) {
        if (!pathOrMap) return;

        // Coerce root data to be an Object if it is not currenty an Object or Array
        if (!this._isObjectOrArray) {
            this._isObjectOrArray = true;
            this.data = {};
        }

        if (isObject(pathOrMap)) {
            // pathOrMap is Object of paths mapped to values
            this._triggeredDepSet = new Set();

            for (const path of Object.keys(pathOrMap)) {
                let val = pathOrMap[path];

                // Run mutator function for the set path if once exists
                if (this._mutators[path] instanceof Function) {
                    val = this._mutators[path](val, this);
                }

                this._setAtPath(path, val);
            }

            delete this._triggeredDepSet;

        } else {
            // pathOrMap is a single path to assign
            const path = pathOrMap;

            // Run mutator function for the set path if once exists
            if (this._mutators[path] instanceof Function) {
                value = this._mutators[path](value, this);
            }
            
            this._setAtPath(path, value);
        }
    }
    
    // Iterate through valid paths and unset values
    delete(...paths) {
        // Only run if root data is an Object or Array and paths are available
        if (!this._isObjectOrArray) return;

        this._triggeredDepSet = new Set();

        for (const path of paths) {
            this._setAtPath(path, ReactiveStore.DELETE);
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

    updateMutators(newMutators) {
        if (isObject(newMutators)) {
            Object.assign(this._mutators, newMutators);
        }
    }

    removeMutators(...paths) {
        for (const path of paths) {
            delete this._mutators[path];
        }
    }

    _setAtPath(path, value) {
        const pathSplit = path.split('.'),
            parentDeps = [];

        let deps = this._rootNode.subDeps,
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
                const keyExists = search.hasOwnProperty(pathToken),
                    unset = (value === ReactiveStore.DELETE); // Unset if value is ReactiveStore.DELETE

                if (!unset || keyExists) {
                    const oldValue = search[pathToken];

                    let changed = true;
        
                    if (unset) {
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
                        
                        this._triggerDep(this._rootNode.dep);
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
    
        if (oldValue instanceof Object) {
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
                        for (const subKey of keys) {
                            const subDepNode = subDeps ? subDeps[subKey] : false;

                            // If we already know that oldValue has changed, only keep traversing if there are unchecked sub-dependencies
                            if (changed) {
                                if (!subDeps) break;
                                if (!subDepNode) continue;
                            }

                            const subDepsChanged = this._triggerChangedDeps(subDepNode, oldValue[subKey], newValueIsObjectOrArray ? newValue[subKey] : undefined);

                            if (!searchedForChangedSubDeps) searchedForChangedSubDeps = true;
                            if (subDepsChanged && !changed) changed = true;                            
                        }
                    }
                    
                } else {
                    // If there is a custom equality check for the oldValue's instance type (e.g. Set, Date, etc), run that
                    changed = !customEqChecks[oldConstructor.name] || !customEqChecks[oldConstructor.name](oldValue, newValue);
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
