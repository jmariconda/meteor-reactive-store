import { Tracker } from 'meteor/tracker';
import { isObject, isTraversable, ensureDepNode } from './helpers';
 
/**
 * @typedef path - Dot-notated path string.
 * @type {string}
 * 
 * @typedef DepNode - Dependency node object.
 * @type {Object}
 * @property {Tracker.Dependency} [dep] - Tracker dependency associated with this node.
 * @property {Object.<string, DepNode>} subDeps - Map of subKeys -> subDepNodes
 * 
 * @typedef Mutator - Assignment mutator function.
 * @type {Function}
 * @param {any} value - Assigned value
 * @param {ReactiveStore} store - Current ReactiveStore instance
 * @returns {any} Mutated value
 */

/**
 * @class ReactiveStore
 */
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
        this._noMutate = false;
        this._changeData = { deps: new Set(), opCount: 0 };
        this._pathTokensCache = {};
        
        this.data = data;
    }

    // Symbol that can be assigned to path to delete it from the store
    static DELETE = Symbol('DELETE_STORE_PATH');

    // Symbol that can be returned from a mutator to cancel the assign/delete operation
    static CANCEL = Symbol('CANCEL_STORE_ASSIGNMENT');

    // Map of constructors to equality check functions
    static eqCheckMap = new Map([
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

        ReactiveStore.eqCheckMap.set(constructor, isEqual);
    }

    // Remove custom equality check for instances of the given constuctor
    static removeEqualityCheck(constructor) {
        if (!(constructor instanceof Function)) {
            throw new Error('You must provide a valid constructor function/class.');
        }

        ReactiveStore.eqCheckMap.delete(constructor);
    }

    /**
     * Get value at path (and register dependency if reactive)
     * 
     * @param {path} [path] - Path of store value.
     * @returns {any} Current value at path or root value if path is not given.
     */
    get(path) {
        const { depNode, value } = this._findProperty(path);

        if (Tracker.active) {
            // Ensure that dep exists and depend on it
            if (!depNode.dep) {
                depNode.dep = new Tracker.Dependency();
            }

            depNode.dep.depend();
        }

        return value;
    }

    /**
     * @function equals - Check equality of root against comparison value (and register equality dependency if reactive)
     * 
     * @param {any} value - Comparison value.
     * @returns {boolean} Equality of the values.
     *//**
     * @function equals - Check equality of value at path against comparison value (and register equality dependency if reactive)
     * 
     * @param {path} path - Path of store value.
     * @param {any} value - Comparison value.
     * @returns {boolean} Equality of the values.
     */
    equals(...params) {
        // Interpret params based on length
        let path, value;

        if (params.length < 2) {
            // One-parameter config
            ([value] = params);
        } else {
            // Two-parameter config
            ([path, value] = params);
        }

        // Throw error if value is not primitive
        if (value instanceof Object) {
            throw new Error('ReactiveStore: Only primitive values can be registered as equality dependencies (number, string, boolean, undefined, null, Symbol).');
        }

        const search = this._findProperty(path),
            isEqual = (search.value === value);

        if (Tracker.active) {
            // Ensure that equality dep exists for the given value and depend on it
            const { depNode } = search;

            if (!depNode.eqDepMap) {
                depNode.eqDepMap = new Map();
            }
        
            let eqDep = depNode.eqDepMap.get(value);
        
            if (!eqDep) {
                eqDep = new Tracker.Dependency();
                depNode.eqDepMap.set(value, eqDep);
            }
        
            if (isEqual) {
                depNode.activeEqDep = eqDep;
            }

            eqDep.depend();
        }

        return isEqual;
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
     * @function assign - Assign the given value at the given path.
     * 
     * @param {path} path - Path to assign value to.
     * @param {any} value - Value to assign.
     *//**
     * @function assign - Assign each value from the given path -> value map at its corresponding path.
     * 
     * @param {Object.<path, any>} pathValueMap - Object map of path -> value pairs to be assigned.
     */
    assign(...params) {
        const pathValueMap = (params.length >= 2)
            ? { [params[0]]: params[1] }
            : params[0];

        this._watchChanges(() => {
            for (const path of Object.keys(pathValueMap)) {
                this._setAtPath(path, pathValueMap[path]);
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
     * If root data is currently traversable, set it to a new instance of the current constructor.
     * Otherwise, set it to undefined.
     */
    clear() {
        this.set(this._isTraversable ? new this.data.constructor() : undefined);
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
     * Sets the _noMutate flag so that any assignments that happen within the given operation will skip mutations.
     * @param {Function} op - Operation to run without mutations. 
     */
    noMutation(op) {
        this._noMutate = true;
        op();
        this._noMutate = false;
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
        // Mutate value if the _noMutate flag is not set and there is a mutator function for the path        
        if (!this._noMutate && this._mutators[path] instanceof Function) {
            value = this._mutators[path](value, this);
        }

        // Cancel operation if value is ReactiveStore.CANCEL
        if (value === ReactiveStore.CANCEL) {
            return;
        }

        // Unset if value is ReactiveStore.DELETE
        const unset = (value === ReactiveStore.DELETE);

        // Coerce root data to be an Object if it is not currenty traversable
        if (!this._isTraversable) {
            // Cancel the operation if this is an unset because the path doesn't exist
            if (unset) return;

            this._isTraversable = true;
            this.data = {};
        }

        const pathTokens = this._getPathTokens(path),
            lastTokenIdx = (pathTokens.length - 1),
            parentDepNodes = [this._rootNode];

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
                        // Store parent dep node so it can be triggered after we know if targeted child property has definitely changed
                        parentDepNodes.push(depNode);                        
                        deps = depNode.subDeps;
                    } else {
                        deps = null;
                    }
                }

            } else if (!unset || search.propertyIsEnumerable(token)) {
                // Last Token: Set/Unset search at token and handle dep changes
                const depNode = deps && deps[token],
                    oldValue = search[token];

                let changed = true;
    
                if (unset) {
                    // Delete token if unset
                    delete search[token];
    
                    // Trigger dep at token and any subDeps it may have
                    if (depNode) {
                        this._triggerAllDeps(depNode.subDeps, oldValue, undefined);
                        this._registerChange(depNode, undefined);
                    }
    
                } else {
                    // Otherwise, set the new value
                    search[token] = value;
    
                    // Starting with current dep, traverse down and trigger any deps for changed vals
                    changed = this._triggerChangedDeps(depNode, oldValue, value);
                }
    
                if (changed) {
                    // Trigger any active parent dependencies that were hit
                    for (const parentDepNode of parentDepNodes) {
                        this._registerChange(parentDepNode, Object);
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
        const { _changeData } = this;

        _changeData.opCount++;
        op();
        _changeData.opCount--;

        // Once there are no more ops running, trigger all changed deps and clear the set
        if (!_changeData.opCount && _changeData.deps.size) {
            for (const dep of _changeData.deps) {
                dep.changed();
            }

            _changeData.deps = new Set();
        }
    }

    /**
     * If given dep is defined, add it to the change data set to be processed after ops have completed.
     * Also process any equality dependency changes that might have happened.
     * @param {DepNode} depNode - Dependency Node to register.
     * @param {any} newValue - New value at corresponding path in the store
     */
    _registerChange(depNode, newValue) {
        if (depNode) {
            const changedDepSet = this._changeData.deps;

            if (depNode.dep) {
                changedDepSet.add(depNode.dep);
            }

            if (depNode.eqDepMap) {
                const eqDep = depNode.eqDepMap.get(newValue),
                    { activeEqDep } = depNode;

                if (eqDep !== activeEqDep) {
                    if (eqDep) changedDepSet.add(eqDep);
                    if (activeEqDep) changedDepSet.add(activeEqDep);

                    depNode.activeEqDep = eqDep;
                }
            }
        }
    }
    
    /**
     * Recursively traverse down deps and trigger all existing dependencies that are set in the keyFilter.
     * @param {Object.<string, DepNode>} deps - key -> DepNode map to traverse through.
     * @param {Object|Array} keyFilter - This will be traversed in tandem with deps and only shared keys at each level will be triggered.
     *      Traversal branches will also be stopped early if there are no more levels to traverse in keyFilter.
     * @param {any} curValue - Current value at the deps corresponding level in the store. Will be traversed in tandem if traversable.
     * @param {Set} seenTraversableSet - Used to prevent infinite recursion if keyFilter is cyclical.
     */
    _triggerAllDeps(deps, keyFilter, curValue, seenTraversableSet) {
        if (deps && isTraversable(keyFilter)) {
            if (!seenTraversableSet) {
                seenTraversableSet = new Set();
            }

            // Stop traversal if keyFilter has already been seen
            if (!seenTraversableSet.has(keyFilter)) {
                seenTraversableSet.add(keyFilter);

                const curValueIsTraversable = isTraversable(curValue);

                for (const key of Object.keys(deps)) {
                    const curValueAtKey = (curValueIsTraversable && curValue.propertyIsEnumerable(key))
                        ? curValue[key]
                        : undefined;
    
                    this._registerChange(deps[key], curValueAtKey);
    
                    if (keyFilter.propertyIsEnumerable(key)) {
                        this._triggerAllDeps(deps[key].subDeps, keyFilter[key], curValueAtKey, seenTraversableSet);
                    }
                }
            }
        }
    }
    
    /**
     * Check for changes between oldValue and newValue and recursively traverse down to check/trigger
     * deep dependency changes if necessary.
     * @param {DepNode} depNode - DepNode for the current traversal level.
     * @param {any} oldValue - Old value at current traversal level.
     * @param {any} newValue - New value at current traversal level.
     * @param {Set} seenTraversableSet - Used to prevent infinite recursion if oldValue or newValue is cyclical.
     * @returns {boolean} True if value has changed.
     */
    _triggerChangedDeps(depNode, oldValue, newValue, seenTraversableSet) {
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
                if (!seenTraversableSet) {
                    seenTraversableSet = new Set();
                }

                if (seenTraversableSet.has(oldValue) || seenTraversableSet.has(newValue)) {
                    // Assume changed if oldValue or newValue has already been seen once because cyclical data structures cannot be checked for deep changes
                    changed = true;

                } else {
                    // Otherwise, add oldValue to the seenTraversableSet and continue
                    seenTraversableSet.add(oldValue);

                    const newValueIsTraversable = isTraversable(newValue),
                        keySet = new Set(Object.keys(oldValue));                               

                    if (newValueIsTraversable) {
                        // If newValue is also traversable, add it to the seenTraversableSet
                        seenTraversableSet.add(newValue);

                        // Add its keys to the keySet
                        const newValueKeys = Object.keys(newValue);

                        // Definitely changed if values don't share the same constructor or have a different amount of keys
                        if (oldValue.constructor !== newValue.constructor || keySet.size !== newValueKeys.length) {
                            changed = true;
                        }

                        // Only process newValueKeys if we don't already know of any changes, or there are subDeps to process
                        if (!changed || subDeps) {
                            // Add all newValueKeys to the keySet
                            for (const key of newValueKeys) {
                                if (!keySet.has(key)) {
                                    // Definitely changed if newValue key does not exist in oldValue and its value is not undefined
                                    // NOTE: The presence of a new key doesn't matter if it is set to undefined because that means the value hasn't changed.
                                    if (!changed && newValue[key] !== undefined) {
                                        changed = true;
                                        if (!subDeps) break;
                                    }

                                    keySet.add(key);
                                }
                            }
                        }

                        // Set newValueTraversed to true so that _triggerAllDeps check below is skipped
                        newValueTraversed = true;
                        
                    } else {
                        // Definitely changed if newValue is not traversable
                        changed = true;
                    }

                    // Only initiate further traversal if we don't already know of any changes, or there are subDeps to process
                    if (!changed || subDeps) {
                        // Iterate through all unique keys between the old/new values and check for deep changes
                        for (const key of keySet) {
                            const subDepNode = subDeps && subDeps[key];
                            
                            // Only traverse if change has not been found or there is a sub-dependency to check
                            if (!changed || subDepNode) {
                                const newValueAtKey = newValueIsTraversable ? newValue[key] : undefined,
                                    subValueChanged = this._triggerChangedDeps(subDepNode, oldValue[key], newValueAtKey, seenTraversableSet);
                                
                                if (!changed && subValueChanged) {
                                    changed = true;
                                }
                            }                        
                        }
                    }
                }
                
            } else {
                // Run custom equality check for the oldValue's instance type (e.g. Set, Date, etc) if there is one
                const isEqual = ReactiveStore.eqCheckMap.get(oldValue.constructor);

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
            this._triggerAllDeps(subDeps, newValue, newValue);
        }
        
        if (changed) {
            this._registerChange(depNode, newValue);
        }
    
        return changed;
    }

    /**
     * Cache split path tokens if necessary and then return them.
     * @param {path} path - Dot-notated path string to get tokens for.
     */
    _getPathTokens(path) {
        path = String(path);

        if (!this._pathTokensCache[path]) {
            this._pathTokensCache[path] = path.split('.');
        }

        return this._pathTokensCache[path];
    }

    /**
     * Attempt to traverse down current data on the given path creating dep nodes along the way (if reactive)
     * @param {path} path - Path to find
     * @returns {Object} An Object containing search value and related dep node
     */
    _findProperty(path) {
        let depNode = this._rootNode,
            value = this.data;

        // Ignore path if it is undefined or null
        if (path != null) {
            const reactive = Tracker.active,
                pathTokens = this._getPathTokens(path),
                numTokens = pathTokens.length;
            
            let pathExists = true;
        
            for (let i = 0; i < numTokens; i++) {
                const token = pathTokens[i];
        
                if (reactive) {
                    depNode = ensureDepNode(depNode.subDeps, token);
                }
        
                if (pathExists) {
                    if (isTraversable(value) && value.propertyIsEnumerable(token)) {
                        value = value[token];
                    } else {
                        pathExists = false;
                        value = undefined;
                        if (!reactive) break;
                    }
                }
            }
        }
    
        return { depNode, value };
    }
}
