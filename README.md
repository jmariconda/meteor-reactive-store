# Reactive Store

Reactive Store is a reactive data type for Meteor that supports deep dependency tracking.

## Usage:
- ### new ReactiveStore([initialValue: _any_])
    - Initializes the ReactiveStore with any initial value.
- ### get([path: _String_])
    - Provide a dot-notated path string to the property you would like to reactively access
    - The dependency will only trigger if the value at the given path changes.
    - This is a totally safe function, so even if the path doesn't exist yet, it will still return undefined and re-run if/when the path does exist and the value has changed.
    - If no path is provided, the root value will be returned and tracked (because of this, ReactiveStore can essentially stand in as a direct replacement for ReactiveVar).
- ### set(value: _any_)
    - Calling this will override the root value with whatever value is provided.
    - When this happens, ReactiveStore will take into account the previous type of the root value and seach for deep dependency changes accordingly.
- ### assign(pathValMapOrPath: _Object/String_, value: _any_)
    - First param can either be an Object of dot-notated paths mapped to values or a single path. The second param will only be taken into account if it is the latter.
    - This function will go through the path(s) given, set the assigned value(s), and trigger any dependencies that have been affected (at, above, or below the set path).
    - Notes:
        - If the root value is not currently an Object or Array, it will be coerced into an Object.
        - Because Object keys have no guaranteed iteration order, there is no guaranteed order that the paths will be set if an Object of paths mapped to values is provided.
- ### delete(...paths: _String_)
    - Delete all of the given deep paths and trigger dependencies accordingly.
    - Note: This does not do anything unless the root value is an Object or Array.
- ### clear()
    - Reset the root value based on its current type.
    - If it is an Object or Array, it will be reset to {} or [] respectively.
    - Otherwise it will be set to undefined.

## Caveats:
- Deep dependencies cannot be checked if an Object is gotten from the store, modified in place, and then set. In this case, the value will be assumed as changed and all related dependencies will be triggered to be safe. This is because, similarly to ReactiveVar, ReactiveStore does not serialize/clone the data stored in it. This has the benefit of being able to store anything inside of it (unlike ReactiveDict which only supports EJSON types), but you also need to be aware that references will be kept when modifying data. Ideally, you should set deep properties directly, rather than getting, modifying, and setting parent Objects.
- Currently, the only supported class instances for change tracking (besides Objects and Arrays) are Set and Date. If any other instance type is set, it will be assumed as changed. This also follows the same rule stated above (i.e. if you get/modify/set an existing Set/Date in the store, there is no way to check for changes, so it will be assumed as changed). I plan to add a function that can be called at startup to extend the supported object types for change tracking.