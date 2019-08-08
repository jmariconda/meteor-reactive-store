// Symbol that represents the 'path' to the root value
export const ROOT = Symbol('ROOT_STORE_PATH');

// Symbol that can be assigned to path to delete it from the store (also used internally to represent non-existent value)
export const DELETE = Symbol('DELETE_STORE_PATH');

// Symbol that can be returned from a mutator to cancel the assign/delete operation
export const CANCEL = Symbol('CANCEL_STORE_ASSIGNMENT');

// Symbol that marks a value that would normally be traversable as non-traversable
export const SHALLOW = Symbol('SHALLOW_STORE_DATA');
