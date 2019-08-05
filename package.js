Package.describe({
    summary: 'A reactive data storage for Meteor\'s Tracker interface that supports deep dependency tracking.',
    version: '2.3.1',
    name: 'jmaric:deep-reactive-store',
    documentation: 'README.md',
    git: 'https://github.com/jeffm24/meteor-reactive-store.git'
});

Package.onUse((api) => {
    api.use([
        'es5-shim@4.8.0',
        'ecmascript@0.12.7',
        'tracker@1.2.0'
    ]);

    api.mainModule('reactive_store.js');
});

Package.onTest((api) => {
    api.use([
        'es5-shim',
        'ecmascript',
        'tracker',
        'jmaric:deep-reactive-store',
        'meteortesting:mocha'
    ]);
    
    api.mainModule('reactive_store.tests.js');
});
