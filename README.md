# Reactive Store

Reactive Store is a reactive data storage for Meteor's Tracker interface that supports deep dependency tracking.

## Reasoning:
This package was created with the goal of offering a similar interface to ReactiveDict, but without the complications of being based around EJSON.
It also builds on the concept by adding features that allow it to work better as state with its own internal logic.

ReactiveDict works well, but has some drawbacks:
- Storable data is limited to EJSON types. Any other instantiated value will need to have its prototype modified to be EJSON-compatible or a new EJSON-compatible extended class will need to be created in order to store it.
- Internal data is serialized/deserialized for every access/modification. This ensures reference safety so that internal data is not unexpectedly changed from the outside, but sacrifices performance in doing so.
- Does not allow tracking deep dependencies past the first level of keys.
- Does not allow linking logic to the keys so that state can be managed/mutated on change.

ReactiveStore aims to solve these in the following ways:
- __Important:__ Internal data is not serialized. This allows for faster accesses/modifications and storage of any value with the following caveats:
    - The user must be aware that any changes made to the data outside of the store's interface will not be tracked.
    - Any instantiated value that is gotten, modified, and assigned in the store will be assumed to have changed since identical instance references cannot be diffed, as they literally point to the same instance.
    - Cyclical json data can technically be stored, but the store will assume value has changed if a cyclical path is found while performing diffs.
- Values can be queried at the root or any depth within the store via dot-notated paths.
    - This means that reactivity can be scoped to exactly the data that you need.
- Provides interface to link logic directly to any path within the store via mutator functions. This allows ReactiveStore to work very well as template state by doing the following:
    - Add a state pointer attribute (e.g. data-state-path="path.to.field") to any DOM inputs that should modify state
    - Add a single event handler that catches changes to any [data-state-path] elements and directly calls `assign` with the element's state path and value
    - Define mutator functions for all state paths that will be assigned this way to handle processing raw input values or doing side effects on the store

## Installation:
Add the package:
> meteor add jmaric:deep-reactive-store

Then in any file:
> import ReactiveStore from 'meteor/jmaric:deep-reactive-store';

## Usage:
- ### (_constructor_) ReactiveStore([initialValue: _Any_[, pathMutatorMap: _Object<path, function>_]])
    - Initializes the ReactiveStore with any initial value.
    - If provided, pathMutatorMap should map dot-notated paths to functions with parameters (value[, store]) that will mutate and return assigned/deleted values (see assign/delete function notes below).
    - Check utility section below for special values that can be returned from mutators.

- ### Accessors:

    - #### get([path: _String_])
        - If no path is provided, reactively returns the current root value (similar to ReactiveVar get functionality).
        - If a path is provided, reactively returns the current value at that path.
        - Path should be provided in dot-notation (e.g. 'some.deep.property')
        - The dependency will only re-run if the queried value changes.
        - This is a totally safe function, so even if the path doesn't exist yet, it will return undefined and re-run if/when the path does exist and the value has changed.
        - __Important__: Only enumerable properties can be traversed (i.e. any keys that would be returned from `Object.keys`). This means, for example, that trying to access a stored array's 'length' property or some prototype function will always result in undefined. This applies for any method that accepts a path parameter.

    - #### has(path: _String_)
        - Reactively returns the existence of the given path in the store.
        - This is distinct from `get` and `equals` because those are reactive upon value (i.e. they see a non-existent path and a path set to undefined as the same thing), whereas this is only reactive upon whether or not the path exists.
    
    - #### equals(value: _Any_)
      #### equals(path: _String_, value: _Any_)
        - If no path is provided, reactively returns the equivalency of the root value to the given value.
        - If a path is provided, reactively returns the equivalency of the value at that path to the given value.
        - __Important:__ Only primitive values (string, number, boolean, null, undefined, symbol) and functions can be checked for equivalency
        - The benefit of using this over `get` is that it will only trigger a re-run when the equivalency status changes (e.g. `store.equals(1)` will only fire when the root value is something else and becomes 1, or is 1 and becomes something else)

- ### Modifiers:

    - #### set(value: _Any_)
        - Override the root value with the given value.
    
    - #### assign(path: _String_, value: _Any_])
      #### assign(pathValMap: _Object<path, value>_)
        - To assign a single path, provide a dot-notated path string and a value to assign.
        - To assign multiple paths, provide a single Object of paths mapped to values to assign.
        - This function will go through the path(s) given, set the assigned value(s), and trigger any dependencies that have been affected (at, above, or below the set path).
        - You can assign ReactiveStore.DELETE to a path to delete it from the store. This is the same as calling the `delete` method on that path, but allows you to batch the operation in with other assignments in a single call.
        - If a mutator function is available for a set path, the assigned value will be run through that before processing.
        - Notes:
            - Unless ReactiveStore.DELETE or ReactiveStore.CANCEL is assigned, any depth that does not yet exist in the store will be coerced into an Object as needed based on the assigned paths (e.g. if store value is undefined and you call `store.assign('deep.path', 1)` the new value will be { deep: { path: 1 } }).
            - Because Object keys have no guaranteed iteration order, there is no guaranteed order that the paths will be set if an Object of paths mapped to values is provided.
    
    - #### delete(...paths: _String_)
        - Delete all of the given paths from the store.
        - This does not do anything unless the root value is an Object or Array.
        - If there is a mutator function available for a given path, it will be run with a set value of ReactiveStore.DELETE. This is primarily so that secondary actions
    can be run on the store on delete, but this could technically be used to cancel a delete operation if something other than ReactiveStore.DELETE is returned from the mutator.
    
    - #### clear()
        - Reset the root value based on its current type.
        - If it is an Object or Array, it will be reset to {} or [] respectively.
        - Otherwise, it will be set to undefined.

- ### Utility:

    - #### abstract(path: _String_)
        - Creates a ReactiveVar-like object with dedicated get/equals/set/delete functions to access/modify the given path in the store.
        - Created object is cached after the first call, so repeated calls for the same path will always return the same object.
        - Useful if you want to pass around access to a specific field in the store via a simpler interface without having to pass around the store itself.
        - The internal functions of the generated object map like so:
            - get() -> store.get(path)
            - equals(val) -> store.equals(path, val)
            - set(val) -> store.assign(path, val)
            - delete() -> store.delete(path)

    - #### updateMutators(pathMutatorMap: _Object_) 
        - Update current mutators for the paths in the given path -> mutator map.
        - Map should be formatted as described above in the constructor documentation.

    - #### noMutation(callback: _Function_)
        - Mutations will be skipped for any assign/delete calls within the given callback.
        - Particularly useful inside of mutator functions if you just want to assign values to other fields in the store without running any mutators they might have.

    - #### removeMutators(...paths: _String_)
        - Remove any mutators associated with the given paths.

    - #### (_static_) ReactiveStore.addEqualityCheck(constructor: _Function/Class_, isEqual: _Function_)
        - Add a function that will be used for checking equality between _different_ instances of the given constructor.
        - The isEqual function should take two parameters (oldValue, newValue) and return a truthy/falsy value that will used to determine if they are equal.
        - By default, there are already equality checks for Set, Date, and RegExp instances, but these can be overridden if you need to for some reason.
        - Equality checks are global for all instances of ReactiveStore, so they only need to be defined once.

    - #### (_static_) ReactiveStore.removeEqualityCheck(constructor: _Function/Class_)
        - Remove an existing equality checking function.

    - #### (_static_) ReactiveStore.shallow(value: _Any_)
        - If the given value is traversable (i.e. plain Object/Array), it will be tagged with the ReactiveStore.SHALLOW symbol to make it not traversable.
        - Values marked in this way will never be traversed, which means that accesses to sub-properties within them will be ignored and return undefined.
        - Newly set/assigned shallow values will be assumed as changed unless there is a custom equality check function defined for their constructors (Object/Array).
        - NOTE: Shallow values will be coerced to {} if a new property is set within them via the `assign` method.
        - This is useful in the following cases:
            - You know that you will not be querying for deep values within the stored value.
            - You already know that the value has changed or just don't want ReactiveStore to perform a deep-diff check when the value is set/assigned.
            - You want to override the default deep-diff check with a custom equality check.

    - #### (_static_) ReactiveStore.CANCEL: _Symbol_
        - Symbol that can be returned from mutators to cancel the assign/delete operation for the related path.
        - Useful if you want to create a mutation path that is only used for side effects on the store.
    
    - #### (_static_) ReactiveStore.DELETE: _Symbol_
        - Symbol that can be assigned to paths to delete them from the store.
        - Useful for mutator functions when you want to conditionally unset the path, or if you want to set and delete paths all in the same call to the assign function.
        - Note: This symbol is the value that is assigned internally whenever the delete method is called for a given path.

## A Few Examples:
```javascript
import ReactiveStore from 'meteor/jmaric:deep-reactive-store';

const store = new ReactiveStore({
    // Initial data
}, {
    // Path mutator
    'some.deep.path': function (value, store) {
        /*
         * This will run whenever 'some.deep.path' is directly assigned or deleted to/from the store and use the returned value for the respective operation.
         * From inside of here you can also use the store parameter to perform secondary actions such as running assign/delete on other fields.
         */
        
        return value;
    }
});

// Reactively get the root value of the store
// This will rerun when inside of an active Tracker context and the root value changes (via set method)
store.get()

// Reactively get some deep value from the store
// This will rerun when inside of an active Tracker context and the value at the given path changes (directly or indirectly)
store.get('some.deep.path')

// Safe non-reactive get (if you do not know the field exists)
Tracker.nonreactive(() => store.get())
Tracker.nonreactive(() => store.get('some.deep.path'))

// Manual non-reactive get (if you know the field exists)
store.data
store.data.some.deep.path

// Reactively check for existence of deep value in the store.
store.has('some.deep.path')

// Reactively check equality of root value of the store against any primitive value.
// This will rerun when inside of an active Tracker context and the equality status changes
store.equals('some value')

// Reactively check equality of a deep value in the store against any primitive value.
// This will rerun when inside of an active Tracker context and the equality status changes
store.equals('some.deep.path', 'some value')

// Non-reactive equality checks
Tracker.nonreactive(() => store.equals('some value'))
Tracker.nonreactive(() => store.equals('some.deep.path', 'some value'))

// Single path assignment
store.assign('some.deep.path', 'some value')

// Multi-path assignment/deletion
store.assign({
    'topField': true,
    'some.deep.path': {},
    'delete.path': ReactiveStore.DELETE
})

// Path deletion
store.delete('topField', 'some.deep.path')

// Set store root value
store.set([1, 2, 3])
store.set({ key: true })

// NOTE: Reactive deep get/equals calls with paths will be ignored while the root value is not traversable (Object/Array)
// The store is effectively the same as ReactiveVar in this case but with type-based equality checking for instantiated values (if an equality check has been added).
store.set(new Date()) 
store.set(true)

// Clear the store (Object -> {}, Array -> [], <other> -> undefined)
store.clear()

// Create a access/mutate object for a specific path
store.abstract('some.deep.path')

// Add mutator(s)
store.updateMutators({
    'another.deep.field': function (value, store) {
        // ...
    },
    // ...
})

// Skip mutations
store.noMutation(() => {
    // No mutators will run while inside this callback
    store.assign('another.deep.field', 1);
    store.delete('some.deep.path');
})

// Remove mutator(s)
store.removeMutators('another.deep.field', 'some.deep.path')

// Set/assign shallow root values (this means that root will be coerced to {} if assign is called)
store.set(ReactiveStore.shallow({ some: { property: true } }))
store.set(ReactiveStore.shallow([1, 2, 3, 4]))
store.assign({ 'some.deep': ReactiveStore.shallow({ field: 1 }) })

// Add custom equality check
ReactiveStore.addEqualityCheck(Date, function (oldDate, newDate) {
    // This will run if a field that was previously a Date instance is set to a new Date
    return (newDate instanceof Date && oldDate.getTime() === newDate.getTime());
})

// Remove custom equality check
ReactiveStore.removeEqualityCheck(Date)

```
