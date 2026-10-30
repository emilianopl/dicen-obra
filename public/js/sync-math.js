// public/js/sync-math.js
// Cálculos de sincronización compartidos entre el navegador y los tests de Node.
// Cada video tiene dos mitades de igual duración (pausa y play); la posición dentro
// de la mitad se deriva del reloj del servidor, así que nunca depende de otra pantalla.
(function (root) {
    // Posición (segundos) dentro de una mitad según el reloj del servidor
    function positionInHalf(serverNowMs, epochMs, halfDuration) {
        const elapsed = (serverNowMs - epochMs) / 1000;
        return ((elapsed % halfDuration) + halfDuration) % halfDuration;
    }

    // Tiempo absoluto del video para la mitad indicada (0 = primera, 1 = segunda)
    function targetTime(serverNowMs, epochMs, halfDuration, half) {
        return positionInHalf(serverNowMs, epochMs, halfDuration) + half * halfDuration;
    }

    // Desfase circular dentro de la mitad, en [-H/2, H/2): positivo = el video va adelantado
    function drift(position, target, halfDuration) {
        const d = (((position - target) % halfDuration) + halfDuration) % halfDuration;
        return d >= halfDuration / 2 ? d - halfDuration : d;
    }

    // Velocidad de reproducción proporcional al desfase, acotada a ±maxRateDelta
    function playbackRateFor(driftSeconds, { deadband = 0.03, gain = 0.5, maxRateDelta = 0.05 } = {}) {
        if (Math.abs(driftSeconds) < deadband) return 1;
        const delta = Math.max(-maxRateDelta, Math.min(maxRateDelta, -driftSeconds * gain));
        return 1 + delta;
    }

    // Una medición de reloj tipo NTP: offset = reloj del servidor - reloj local
    function clockSample(sentAtMs, serverTimeMs, receivedAtMs) {
        return { offset: serverTimeMs - (sentAtMs + receivedAtMs) / 2, rtt: receivedAtMs - sentAtMs };
    }

    // Se queda con la medición de menor ida y vuelta, que es la más confiable
    function bestOffset(samples) {
        if (!samples.length) return 0;
        return samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
    }

    const api = { positionInHalf, targetTime, drift, playbackRateFor, clockSample, bestOffset };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DicenSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
