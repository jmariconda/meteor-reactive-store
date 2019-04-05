# Reactive Store

Reactive Store is a reactive data type for Meteor that supports deep dependency tracking.

## Installation:
Add the package:
> meteor add jmaric:deep-reactive-store

Then in any file:
> import ReactiveStore from 'meteor/jmaric:deep-reactive-store';

## Usage:
- ### (_constructor_) ReactiveStore([initialValue: _Any_[, pathMutatorMap: _Object_]])
    - Initializes the ReactiveStore with any initial value.
    - If provided, pathMutatorMap should map dot-notated paths to functions with parameters (value[, store]) that will mutate and return assigned/deleted values (see assign/delete function notes below).
- ### get([pathOrOptions: _String/Object_[, options: _Object_]])
    - If the first parameter is an Object, it will be interpreted as options and the second parameter will be ignored; otherwise, the first parameter will be interpreted as the path.
    - Provide a dot-notated path string to the property you would like to reactively access
    - The dependency will only trigger if the value at the given path changes.
    - This is a totally safe function, so even if the path doesn't exist yet, it will still return undefined and re-run if/when the path does exist and the value has changed.
    - If no path is provided, the root value will be returned and tracked (because of this, ReactiveStore can essentially stand in as a direct replacement for ReactiveVar).
    - Options:
        - reactive (_Boolean_): If this is set to a falsy value, the query will not be tracked.
    - Notes:
        - Options can also be parsed from a Spacebars.kw hash passed from Blaze (e.g. {{store.get 'field' reactive=false}} or {{store.get reactive=false}} if you make the store accessible in your template).
- ### set(value: _Any_)
    - Calling this will override the root value with whatever value is provided.
    - When this happens, ReactiveStore will take into account the previous type of the root value and search for deep dependency changes accordingly.
- ### assign(pathValMapOrPath: _Object/String_[, value: _Any_])
    - First parameter can either be an Object of dot-notated paths mapped to values or a single path. The second value param must be provided if it is the latter.
    - This function will go through the path(s) given, set the assigned value(s), and trigger any dependencies that have been affected (at, above, or below the set path).
    - Notes:
        - If a mutator function is available for a set path, the respective value will be run through that before processing.
        - If the root value is not currently an Object or Array, it will be coerced into an Object.
        - Because Object keys have no guaranteed iteration order, there is no guaranteed order that the paths will be set if an Object of paths mapped to values is provided.
- ### delete(...paths: _String_)
    - Delete all of the given deep paths and trigger dependencies accordingly.
    - Notes:
        - This does not do anything unless the root value is an Object or Array.
        - If there is a mutator function available for a given path, it will be run with a set value of ReactiveStore.DELETE. This is primarily so that secondary actions
        can be run on the store on delete, but this could technically be used to cancel a delete operation if something other than ReactiveStore.DELETE is returned from the mutator.
- ### clear()
    - Reset the root value based on its current type.
    - If it is an Object or Array, it will be reset to {} or [] respectively.
    - Otherwise it will be set to undefined.
- ### updateMutators(newPathMutatorMap: _Object_) 
    - Update current mutators with the paths in the given path-mutator map.
    - Map should be formatted as described above in the constructor documentation.
- ### removeMutators(...paths: _String_)
    - Remove any mutators associated with the given paths.
- ### (_static_) ReactiveStore.addEqualityCheck(constructor: _Function/Class_, eqCheck: _Function_)
    - Add an equality checking function that will be used for instances of the given constructor.
    - The eqCheck function should take two parameters (oldValue, newValue) and return a truthy/falsy value that will used to determine if they are equal.
    - By default, there are already equality checks for Set and Date instances, but these can be overridden if you need to for some reason.
    - The first caveat stated below still applies for this.
- ### (_static_) ReactiveStore.removeEqualityCheck(constructor: _Function/Class_)
    - Remove an existing equality checking function
- ### (_static_) ReactiveStore.DELETE: _Symbol_
    - Symbol that can be assigned to paths to delete them from the store.
    - Useful for mutator functions when you want to conditionally unset the path, or if you want to set and delete paths all in the same call to the assign function.
    - Note: This symbol is the value that is 'set' internally whenever the delete method is called for a given path.

## A Few Examples:
```javascript
import ReactiveStore from 'meteor/jmaric:deep-reactive-store';

const store = new ReactiveStore({
    // Initial data
}, {
    // Path mutator
    'some.deep.value': function (value, store) {
        /*
         * This will run whenever 'some.deep.value' is assigned or deleted to/from the store and use the returned value for the respective operation.
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
store.get('some.deep.value')

// Safe non-reactive get (if you do not know the field exists)
store.get({ reactive: false })
store.get('some.deep.value', { reactive: false })

// Manual non-reactive get (if you know the field exists)
store.data
store.data.some.deep.value

// Single path assignment
store.assign('some.deep.value', 'some value')

// Multi-path assignment/deletion
store.assign({
    'topField': true,
    'some.deep.value': {},
    'delete.path': ReactiveStore.DELETE
})

// Path deletion
store.delete('topField', 'some.deep.value')

// Set store root value
store.set([1, 2, 3])
store.set({ key: true })

// NOTE: Reactive 'get' calls with paths will be ignored while the root value is not traversable (Object/Array)
// The store is effectively the same as ReactiveVar in this case but with instance-based equality checking (if set)
store.set(new Date()) 
store.set(true)

// Clear the store (Object -> {}, Array -> [], <other> -> undefined)
store.clear()

// Add mutator(s)
store.updateMutators({
    'another.deep.field': function (value, store) {
        // ...
    }
})

// Remove mutator(s)
store.removeMutators('another.deep.field', 'some.deep.value')

// Add custom equality check
ReactiveStore.addEqualityCheck(Date, function (oldDate, newDate) {
    // This will run if a field that was previously a Date instance is set to a new Date
    return (newDate instanceof Date && oldDate.getTime() === newDate.getTime());
})

// Remove custom equality check
ReactiveStore.removeEqualityCheck(Date)

```

## Caveats:
- Deep dependencies cannot be checked if a referenced value is gotten from the store, modified in place, and then set. In this case, the value will be assumed as changed and all related dependencies will be triggered to be safe. This is because, similarly to ReactiveVar, ReactiveStore does not serialize/clone the data stored in it. This has the benefit of being able to store anything inside of it (unlike ReactiveDict which only supports EJSON types), but you also need to be aware that references will be kept when modifying data. Ideally, you should set deep properties directly or set a new instance, rather than getting, modifying, and setting the existing reference.
- For efficiency reasons, ReactiveStore will only check for deep Object/Array changes as far as it needs to. This means that once a change has been found, if there are no deeper dependencies to check, the deep traversal will stop and any relevant dependency changes will be triggered. If you have many deep dependencies registered and only one or two need to be changed, you may want to use the assign() function to directly target and change them in order to avoid unnecessary traversal.