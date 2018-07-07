# Reactive Store

Reactive Store is a reactive data type for Meteor that supports deep dependency tracking.

## Installation:
Add the package:
> meteor add jmaric:deep-reactive-store

Then in any file:
> import ReactiveStore from 'meteor/jmaric:deep-reactive-store';

## Usage:
- ### new ReactiveStore([initialValue: _any_])
    - Initializes the ReactiveStore with any initial value.
- ### get([path: _String_], [options: _Object_])
    - Provide a dot-notated path string to the property you would like to reactively access
    - The dependency will only trigger if the value at the given path changes.
    - This is a totally safe function, so even if the path doesn't exist yet, it will still return undefined and re-run if/when the path does exist and the value has changed.
    - If no path is provided, the root value will be returned and tracked (because of this, ReactiveStore can essentially stand in as a direct replacement for ReactiveVar).
    - Options:
        - reactive (_boolean_): If this is set to a falsy value, the query will not be tracked.
- ### set(value: _any_)
    - Calling this will override the root value with whatever value is provided.
    - When this happens, ReactiveStore will take into account the previous type of the root value and seach for deep dependency changes accordingly.
- ### assign(pathValMapOrPath: _Object/string_, value: _any_)
    - First param can either be an Object of dot-notated paths mapped to values or a single path. The second param will only be taken into account if it is the latter.
    - This function will go through the path(s) given, set the assigned value(s), and trigger any dependencies that have been affected (at, above, or below the set path).
    - Notes:
        - If the root value is not currently an Object or Array, it will be coerced into an Object.
        - Because Object keys have no guaranteed iteration order, there is no guaranteed order that the paths will be set if an Object of paths mapped to values is provided.
- ### delete(...paths: _string_)
    - Delete all of the given deep paths and trigger dependencies accordingly.
    - Note: This does not do anything unless the root value is an Object or Array.
- ### clear()
    - Reset the root value based on its current type.
    - If it is an Object or Array, it will be reset to {} or [] respectively.
    - Otherwise it will be set to undefined.    
- ### (_static_) ReactiveStore.addEqualityCheck(constructor: _function/class_, eqCheck: _function_)
    - Add an equality checking function that will be used for instances of the given constructor.
    - The eqCheck function should take two parameters (oldValue, newValue) and return a truthy/falsy value that will used to determine if they are equal.
    - By default, there are already equality checks for Set and Date instances, but these can be overridden if you need to for some reason.
    - The caveat stated below still applies for this.

## Caveat:
- Deep dependencies cannot be checked if a referenced value is gotten from the store, modified in place, and then set. In this case, the value will be assumed as changed and all related dependencies will be triggered to be safe. This is because, similarly to ReactiveVar, ReactiveStore does not serialize/clone the data stored in it. This has the benefit of being able to store anything inside of it (unlike ReactiveDict which only supports EJSON types), but you also need to be aware that references will be kept when modifying data. Ideally, you should set deep properties directly or set a new instance, rather than getting, modifying, and setting the existing reference.