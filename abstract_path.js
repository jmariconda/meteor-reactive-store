import { isObject, isSpacebarsKw } from './helpers';

/**
 * @class AbstractPath
 */
export default class AbstractPath {
    constructor(store, path) {
        this._store = store;
        this._basePath = String(path);
        this._pathCache = {};
    }

    get(subPath) {
        const path = (subPath)
            ? this._getPath(subPath)
            : this._basePath;

        return this._store.get(path);
    }

    equals(...params) {
        let path, value;

        if (params.length > 1 && !isSpacebarsKw(params[1])) {
            // Two-parameter config
            path = this._getPath(params[0]);
            ({ 1: value } = params);
        } else {
            // One-parameter config
            path = this._basePath;
            ({ 0: value } = params);
        }

        return this._store.equals(path, value);
    }

    exists() {
        return this._store.has(this._basePath);
    }

    has(subPath) {
        return this._store.has(this._getPath(subPath));
    }

    set(value) {
        this._store.assign(this._basePath, value);
    }

    assign(...params) {
        const pathValueMap = {};
        
        if (params.length > 1 && !isSpacebarsKw(params[1])) {
            // Two-parameter config
            const [subPath, value] = params;

            pathValueMap[this._getPath(subPath)] = value;
        } else {
            // One-parameter config
            const [subPathValueMap] = params;

            if (isObject(subPathValueMap)) {
                for (const [subPath, value] of Object.entries(subPathValueMap)) {
                    pathValueMap[this._getPath(subPath)] = value;
                }
            }
        }

        this._store.assign(pathValueMap);
    }

    delete(...subPaths) {            
        this._store.delete(...subPaths.map(subPath => this._getPath(subPath)));
    }

    _getPath(subPath) {
        const { _pathCache } = this;

        if (!_pathCache[subPath]) {
            _pathCache[subPath] = `${this._basePath}.${subPath}`;
        }

        return _pathCache[subPath];
    }
}
