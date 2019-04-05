import { Tracker } from 'meteor/tracker';
import { Spacebars } from 'meteor/spacebars';

/**
 * Dot-notated path string.
 * @typedef path
 * @type {string}
 * 
 * Dependency node object.
 * @typedef DepNode
 * @type {Object}
 * @property {Tracker.Dependency} [dep] - Tracker dependency associated with this node.
 * @property {Object.<string, DepNode>} subDeps - Map of subKeys -> subDepNodes
 * 
 * Assignment mutator function.
 * @typedef Mutator
 * @type {Function}
 * @param {any} value - Assigned value
 * @param {ReactiveStore} store - Current ReactiveStore instance
 * @returns {any} Mutated value
 */

const isObject = val => (val instanceof Object && val.constructor === Object),
    isTraversable = val => (isObject(val) || Array.isArray(val)),
    ensureDep = (depNode) => {
        if (!depNode.dep) {
            depNode.dep = new Tracker.Dependency();
        }

        return depNode.dep;
    },
    ensureDepNode = (deps, key) => {
        if (!deps[key]) {
            deps[key] = { subDeps: {} };
        }

        return deps[key];
    };

export default class ReactiveStore {
    /**
     * @param {any} data - Initial root value.
     * @param {Object.<path, Mutator>} mutators - path -> Mutator map
     */
    constructor(data, mutators) {
        this._deps = {};
        this._rootNode = ensureDepNode(this._deps, 'root');
        this._isTraversable = isTraversable(data);
        this._mutators = isObject(mutators) ? mutators : {};
        this._changeData = { deps: new Set(), opCount: 0 };
        this._pathTokensCache = {};
        
        this.data = data;
    }

    // Symbol that can be assigned to path to delete it from the store
    static DELETE = Symbol('DELETE_PATH');

    // Map of constructor names to equality check functions
    static customEqChecks = new WeakMap([
        [
            Set, function (oldSet, newSet) {
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
            }
        ], [
            Date, function (oldDate, newDate) {
                return (newDate instanceof Date && oldDate.getTime() === newDate.getTime());
            }
        ]
    ]);

    // Add custom equality check for instances of the given constuctor
    static addEqualityCheck(constructor, isEqual) {
        if (!(constructor instanceof Function) || !(isEqual instanceof Function) || isEqual.length !== 2) {
            throw new Error('You must provide a valid constructor function/class and an equality check function that takes two parameters (oldValue, newValue).');
        }

        ReactiveStore.customEqChecks.set(constructor, isEqual);
    }

    // Remove custom equality check for instances of the given constuctor
    static removeEqualityCheck(constructor) {
        if (!(constructor instanceof Function)) {
            throw new Error('You must provide a valid constructor function/class.');
        }

        ReactiveStore.customEqChecks.delete(constructor);
    }

    /**
     * Get value at path (or root if no path is given) and register related dependency if reactive.
     * @param {path|getOptions} pathOrOptions - Path or options object.
     * @param {getOptions} [options] - Options object (only used if path is provided as first parameter).
     * 
     * @typedef getOptions
     * @type {Object}
     * @property {boolean} [reactive=true] - If true, a dependency will be registered and tracked for the targeted path.
     */
    get(pathOrOptions, options) {
        let path = pathOrOptions;

        if (isObject(pathOrOptions) || (pathOrOptions instanceof Spacebars.kw)) {
            // Assume first param is options object if it is an Object or Spacebars.kw 
            options = (pathOrOptions instanceof Spacebars.kw) ? pathOrOptions.hash : pathOrOptions;
            path = null;

        } else if (!isObject(options)) {
            // Use the internal hash object if options is a Spacebars.kw instance
            options = (options instanceof Spacebars.kw) ? options.hash : {};
        }

        // Set default option values if they are not set
        if (!options.hasOwnProperty('reactive')) {
            options.reactive = true;
        }

        const reactive = (Tracker.active && options.reactive);

        let search = this.data,
            pathExists = true;

        if (path != null) {
            // Search down path for value while tracking dependencies (if reactive)
            const pathTokens = this._getPathTokens(path),
                numTokens = pathTokens.length,
                lastTokenIdx = (numTokens - 1);

            for (let i = 0, deps = this._rootNode.subDeps; i < numTokens; i++) {
                const token = pathTokens[i];

                if (reactive) {
                    const depNode = ensureDepNode(deps, token);

                    if (i === lastTokenIdx) {
                        ensureDep(depNode).depend();
                    }
                    
                    deps = depNode.subDeps;
                }

                if (pathExists) {
                    if (isTraversable(search)) {
                        search = search[token];
                    } else {
                        pathExists = false;
                        if (!reactive) break;
                    }
                }
            }

        } else if (reactive) {
            // Otherwise track the root dependency (if reactive)
            ensureDep(this._rootNode).depend();
        }

        if (pathExists) {
            return search;
        }
    }

    /**
     * Replace the root value with the given value.
     * @param {any} value
     */
    set(value) {
        const oldValue = this.data;
        
        this._isTraversable = isTraversable(value);
        this.data = value;

        this._watchChanges(() => this._triggerChangedDeps(this._rootNode, oldValue, value));
    }

    /**
     * Assign given value(s) to the given path(s).
     * @param {path|Object.<path, any>} pathOrMap - Single path or path -> value map.
     * @param {any} [value] - Value to assign (only used when pathOrMap is a single path).
     */
    assign(pathOrMap, value) {
        // Coerce root data to be an Object if it is not currenty traversable
        if (!this._isTraversable) {
            this._isTraversable = true;
            this.data = {};
        }

        this._watchChanges(() => {
            if (isObject(pathOrMap)) {
                // pathOrMap is path -> value map        
                for (const path of Object.keys(pathOrMap)) {        
                    this._setAtPath(path, pathOrMap[path]);
                }
            } else {
                // Assume pathOrMap is path string and use second param as value
                this._setAtPath(pathOrMap, value);
            }
        });
    }
    
    /**
     * Delete all of the given paths from the store.
     * @param {...path} paths - Paths to delete from the store.
     */
    delete(...paths) {
        // Only run if root data is traversable
        if (this._isTraversable) {
            this._watchChanges(() => {
                for (const path of paths) {
                    this._setAtPath(path, ReactiveStore.DELETE);
                }
            });
        }
    }

    /**
     * Reset root data based on current type.
     */
    clear() {
        let newRoot;

        // If root data is currently an Object or Array, reset it to empty Object/Array respectively
        if (isObject(this.data)) {
            newRoot = [];
        } else if (Array.isArray(this.data)) {
            newRoot = {};
        }

        this.set(newRoot);
    }

    /**
     * Update _mutators map with the given newMutators map.
     * @param {Object.<path, Mutator>} newMutators - path -> Mutator map to assign to _mutators.
     */
    updateMutators(newMutators) {
        if (isObject(newMutators)) {
            Object.assign(this._mutators, newMutators);
        }
    }

    /**
     * Delete mutators for given path(s).
     * @param {...path} paths - Paths to delete from _mutators.
     */
    removeMutators(...paths) {
        for (const path of paths) {
            delete this._mutators[path];
        }
    }

    /**
     * Set value at path, creating depth where necessary, and call recursive dependency trigger helpers.
     * @param {path} path - Path to set value at. Will be coerced to a string.
     * @param {any} value - Value to set at path. Path will be deleted from the store if set to ReactiveStore.DELETE.
     */
    _setAtPath(path, value) {
        // Mutate value if there is a mutator function for the path        
        if (this._mutators[path] instanceof Function) {
            value = this._mutators[path](value, this);
        }

        const unset = (value === ReactiveStore.DELETE), // Unset if value is ReactiveStore.DELETE
            pathTokens = this._getPathTokens(path),
            lastTokenIdx = (pathTokens.length - 1),
            parentDeps = [this._rootNode.dep];

        let deps = this._rootNode.subDeps,
            search = this.data;
            
        for (let tokenIdx = 0; tokenIdx <= lastTokenIdx; tokenIdx++) {
            const token = pathTokens[tokenIdx];
            
            if (tokenIdx < lastTokenIdx) {
                // Parent Token: Ensure that search[token] is traversable, step into it, and store active deps
                if (!isTraversable(search[token])) {
                    // Cancel the operation if this is an unset because the path doesn't exist
                    if (unset) return;

                    search[token] = {};
                }

                search = search[token];

                if (deps) {
                    const depNode = deps[token];

                    if (depNode) {
                        // If parent node has dependency, store it so it can be triggered after we know that 
                        // the targeted child property has definitely changed
                        if (depNode.dep) {
                            parentDeps.push(depNode.dep);
                        }
                        
                        deps = depNode.subDeps;

                    } else {
                        deps = null;
                    }
                }

            } else if (!unset || search.hasOwnProperty(token)) {
                // Last Token: Set/Unset search at token and handle dep changes
                const depNode = deps && deps[token],
                    oldValue = search[token];

                let changed = true;
    
                if (unset) {
                    // Delete token if unset
                    delete search[token];
    
                    // Trigger dep at token and any subDeps it may have
                    if (depNode) {
                        this._triggerAllDeps(depNode.subDeps, oldValue);
                        this._registerChange(depNode.dep);
                    }
    
                } else {
                    // Otherwise, set the new value
                    search[token] = value;
    
                    // Starting with current dep, traverse down and trigger any deps for changed vals
                    changed = this._triggerChangedDeps(depNode, oldValue, value);
                }
    
                if (changed) {
                    // Trigger any active parent dependencies that were hit
                    for (const dep of parentDeps) {
                        this._registerChange(dep);
                    }
                }
            }
        }
    }

    /**
     * Wrapper to track changed dependencies within the given operation and then trigger all of them at once after there are no more operations pending.
     * @param {Function} op - Operation to run.
     */
    _watchChanges(op) {
        this._changeData.opCount++;

        op();

        this._changeData.opCount--;

        // Once there are no more ops running, trigger all changed deps and clear the set
        if (!this._changeData.opCount && this._changeData.deps.size) {
            for (const dep of this._changeData.deps) {
                dep.changed();
            }

            this._changeData.deps = new Set();
        }
    }

    /**
     * If given dep is defined, add it to the change data set to be processed after ops have completed.
     * @param {Tracker.Dependency} dep - Dependency to register.
     */
    _registerChange(dep) {
        if (dep) {
            this._changeData.deps.add(dep);
        }
    }
    
    /**
     * Recursively traverse down deps and trigger all existing dependencies that are set in the keyFilter.
     * @param {Object.<string, DepNode>} deps - key -> DepNode map to traverse through.
     * @param {Object|Array} keyFilter - This will be traversed in tandem with deps and only shared keys at each level will be triggered.
     *      Traversal branches will also be stopped early if there are no more levels to traverse in keyFilter.
     */
    _triggerAllDeps(deps, keyFilter) {
        if (deps && isTraversable(keyFilter)) {
            for (const key of Object.keys(deps)) {
                this._registerChange(deps[key].dep);

                if (keyFilter.hasOwnProperty(key)) {    
                    this._triggerAllDeps(deps[key].subDeps, keyFilter[key]);
                }
            }
        }
    }
    
    /**
     * Check for changes between oldValue and newValue and recursively traverse down to check/trigger
     * deep dependency changes if necessary.
     * @param {DepNode} depNode - DepNode for the current traversal level.
     * @param {any} oldValue
     * @param {any} newValue
     * @returns {boolean} True if value has changed.
     */
    _triggerChangedDeps(depNode, oldValue, newValue) {
        const subDeps = depNode && depNode.subDeps;

        let newValueTraversed = false,
            changed = false;
    
        if (oldValue instanceof Object) {
            // oldValue is instantiated reference 
            if (oldValue === newValue) {
                // Cannot check for differences if oldValue and newValue are literally the same reference, so assume changed.
                changed = true;

            } else if (isTraversable(oldValue)) {
                // If oldValue is traversable...
                const newValueIsTraversable = isTraversable(newValue),
                    keySet = new Set(Object.keys(oldValue));

                if (newValueIsTraversable) {
                    // If newValue is also traversable, add its keys to the keySet
                    const newValueKeys = Object.keys(newValue);

                    // Definitely changed if values don't share the same constructor or have a different amount of keys
                    if (oldValue.constructor !== newValue.constructor || keySet.size !== newValueKeys.length) {
                        changed = true;
                    }

                    for (const key of newValueKeys) {
                        keySet.add(key);
                    }

                    // Set newValueTraversed to true so that _triggerAllDeps check below is skipped
                    newValueTraversed = true;
                } else {
                    // Definitely changed if newValue is not traversable
                    changed = true;
                }

                // If we already know that value has changed, only keep traversing if there are unchecked sub-dependencies
                if (!changed || subDeps) {
                    // Iterate through all unique keys between the old/new values and check for deep changes
                    for (const key of keySet) {
                        const subDepNode = subDeps && subDeps[key];
                        
                        // Only traverse if change has not been found or there is a sub-dependency to check
                        if (!changed || subDepNode) {
                            const newValueAtKey = newValueIsTraversable ? newValue[key] : undefined,
                                subValueChanged = this._triggerChangedDeps(subDepNode, oldValue[key], newValueAtKey);
                            
                            if (!changed && subValueChanged) {
                                changed = true;
                            }
                        }                        
                    }
                }
                
            } else {
                // Run custom equality check for the oldValue's instance type (e.g. Set, Date, etc) if there is one
                const isEqual = ReactiveStore.customEqChecks.get(oldValue.constructor);

                if (!isEqual || !isEqual(oldValue, newValue)) {
                    changed = true;
                }
            }

        } else if (oldValue !== newValue) {
            // oldValue is primitive/null: perform basic equivalency check
            changed = true;
        }

        // Trigger all deep dependencies present in newValue if it has not been traversed
        if (!newValueTraversed) {
            this._triggerAllDeps(subDeps, newValue);
        }
        
        if (changed && depNode) {
            this._registerChange(depNode.dep);
        }
    
        return changed;
    }

    /**
     * Cache split path tokens if necessary and then return them.
     * @param {path} path - Dot-notated path string to get tokens for.
     */
    _getPathTokens(path) {
        // Cache split path tokens for faster access on reruns
        path = String(path);

        if (!this._pathTokensCache[path]) {
            this._pathTokensCache[path] = path.split('.');
        }

        return this._pathTokensCache[path];
    }
}
