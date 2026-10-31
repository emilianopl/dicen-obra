// test/sync-math.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../public/js/sync-math.js');

test('positionInHalf da la vuelta al llegar al final de la mitad', () => {
    assert.equal(Sync.positionInHalf(12500, 0, 5), 2.5);
    assert.equal(Sync.positionInHalf(1000, 0, 5), 1);
    // Un epoch en el futuro (reloj recién ajustado) sigue dando una posición válida
    assert.equal(Sync.positionInHalf(0, 1000, 5), 4);
});

test('targetTime suma la mitad correspondiente', () => {
    assert.equal(Sync.targetTime(2000, 0, 5, 0), 2);
    assert.equal(Sync.targetTime(2000, 0, 5, 1), 7);
});

test('drift es circular dentro de la mitad', () => {
    assert.ok(Math.abs(Sync.drift(1.2, 1.0, 10) - 0.2) < 1e-9);
    assert.ok(Math.abs(Sync.drift(1.0, 1.2, 10) + 0.2) < 1e-9);
    // Justo antes del final contra justo después del comienzo: casi sin desfase
    assert.ok(Math.abs(Sync.drift(9.98, 0.02, 10) + 0.04) < 1e-9);
});

test('playbackRateFor frena si va adelantado, acelera si va atrasado y respeta el tope', () => {
    const opts = { deadband: 0.03, gain: 0.5, maxRateDelta: 0.05 };
    assert.equal(Sync.playbackRateFor(0.01, opts), 1);
    assert.ok(Sync.playbackRateFor(0.06, opts) < 1);
    assert.ok(Sync.playbackRateFor(-0.06, opts) > 1);
    assert.equal(Sync.playbackRateFor(5, opts), 0.95);
    assert.equal(Sync.playbackRateFor(-5, opts), 1.05);
});

test('bestOffset usa la medición con menor ida y vuelta', () => {
    const samples = [
        Sync.clockSample(0, 1100, 200),   // rtt 200, offset 1000
        Sync.clockSample(0, 1520, 40),    // rtt 40, offset 1500
        Sync.clockSample(0, 900, 100),    // rtt 100, offset 850
    ];
    assert.equal(Sync.bestOffset(samples), 1500);
    assert.equal(Sync.bestOffset([]), 0);
});
