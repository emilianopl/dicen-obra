// config.js
// Configuración por variables de entorno (ver .env.example)
function num(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && process.env[name] !== '' ? value : fallback;
}

module.exports = {
    port: num('PORT', 8080),
    // Ventana en la que se ignoran toggles repetidos (también cubre el clic simultáneo de ambos lados)
    toggleDebounceMs: num('DICEN_TOGGLE_DEBOUNCE_MS', 400),
    // Parámetros que el servidor manda a cada pantalla
    sync: {
        hardSeekThreshold: num('DICEN_HARD_SEEK_S', 1.0),   // desfase (s) a partir del cual se hace seek
        deadband: num('DICEN_DEADBAND_S', 0.03),            // desfase (s) que se tolera sin corregir
        gain: num('DICEN_GAIN', 0.5),                        // cuánto se acelera/frena por segundo de desfase
        maxRateDelta: num('DICEN_MAX_RATE_DELTA', 0.05),    // velocidad entre 0,95 y 1,05 como máximo
        correctionIntervalMs: num('DICEN_CORRECTION_MS', 500),
        clockSyncIntervalMs: num('DICEN_CLOCK_SYNC_MS', 5000),
        toggleDebounceMs: num('DICEN_TOGGLE_DEBOUNCE_MS', 400),
    },
};
