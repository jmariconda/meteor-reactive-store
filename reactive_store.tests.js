import ReactiveStore from 'meteor/jmaric:deep-reactive-store';
import ReactiveDict from 'meteor/reactive-dict';
import { Tracker } from 'meteor/tracker';
import assert from 'assert';

const assertAutorunRan = (ran) => {
    Tracker.flush();
    assert.equal(ran, true);
};

describe('ReactiveStore', () => {
    describe('#get', () => {
        it('should get root dep', (done) => {
            const test = new ReactiveStore();

            let ran, currentVal;

            Tracker.autorun(() => {
                test.get();
                ran = true;
            });            

            test.set(null);
            assertAutorunRan(ran);
            assert.equal(currentVal, null);
            
            currentVal = undefined;
            ran = false;

            test.set({ test: { deep: true } });
            assertAutorunRan(ran);
            assert.deepEqual(currentVal, { test: { deep: true } });
            

            done();
        });
    });
});
