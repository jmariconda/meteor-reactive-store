Package.describe({
    summary: 'A reactive data storage for Meteor\'s Tracker interface that supports deep dependency tracking.',
    version: '2.1.1_1',
    name: 'jmaric:deep-reactive-store',
    documentation: 'README.md',
    git: 'https://github.com/jeffm24/meteor-reactive-store.git'
});

Package.onUse((api) => {
    api.use(['tracker@1.2.0', 'es5-shim@4.8.0', 'ecmascript@0.12.7']);
    api.mainModule('reactive_store.js');
});

Package.onTest((api) => {
    api.use(['meteortesting:mocha', 'tracker', 'es5-shim', 'ecmascript', 'jmaric:deep-reactive-store']);
    api.mainModule('reactive_store.tests.js');
});
