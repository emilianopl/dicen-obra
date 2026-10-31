// public/js/main.js
// Cada pantalla tiene dos <video> con el mismo archivo (pausa y play pegados en dos mitades).
// Uno se ve y suena; el otro espera listo en segundo plano. Así, el cambio de mitad y la
// vuelta del bucle se hacen sin cortes: se prepara el de atrás y recién ahí se intercambian.
document.addEventListener('DOMContentLoaded', () => {
    if (typeof SCREEN_ID === 'undefined' || !window.DicenSync) {
        console.error('Falta SCREEN_ID en el HTML o no se cargó /js/sync-math.js.');
        return;
    }
    const Sync = window.DicenSync;
    const DEBUG = new URLSearchParams(location.search).has('debug');
    const log = (...args) => { if (DEBUG) console.log(...args); };

    const players = Array.from(document.querySelectorAll('.video-wrapper video'));
    const overlayButton = document.querySelector('.overlay-button');
    const initialPlayButton = document.getElementById('initialPlayButton');
    if (players.length !== 2) {
        console.error('Se esperaban dos elementos <video> en .video-wrapper.');
        return;
    }

    // Cuánto antes del final de la mitad se hace el relevo al video de atrás
    const BOUNDARY_MARGIN_S = 0.05;

    let active = players[0];
    let standby = players[1];
    let halfDuration = null;
    let state = null;            // { half, epoch } recibido del servidor
    let syncConfig = { hardSeekThreshold: 1, deadband: 0.03, gain: 0.5, maxRateDelta: 0.05, correctionIntervalMs: 500, clockSyncIntervalMs: 5000, toggleDebounceMs: 400 };
    let clockSamples = [];
    let clockOffset = 0;
    let switching = false;
    let switchStartedAt = 0;
    let switchId = 0;
    let seekLead = 0.15;         // estimación (s) de lo que tarda un seek + play; se ajusta sola
    let lastDrift = 0;
    let playBlocked = false;     // el navegador bloqueó el autoplay con sonido

    const serverNow = () => Date.now() + clockOffset;
    const ready = () => state !== null && halfDuration !== null;

    function setVisible(el) {
        for (const p of players) {
            const on = p === el;
            p.classList.toggle('visible', on);
            p.muted = !on;
        }
    }

    function tryPlay(el) {
        return el.play().catch(e => {
            console.warn(`No se pudo reproducir: ${e.name}`);
            if (e.name === 'NotAllowedError') {
                playBlocked = true;
                if (initialPlayButton) initialPlayButton.classList.remove('hidden');
            }
            throw e;
        });
    }

    // Tiempo del video que corresponde ahora, en la mitad actual
    function currentTarget() {
        return Sync.targetTime(serverNow(), state.epoch, halfDuration, state.half);
    }

    // Deja el video de atrás en el comienzo de la mitad actual, listo para la vuelta del bucle
    function prepareStandby() {
        if (!ready()) return;
        standby.pause();
        standby.playbackRate = 1;
        standby.currentTime = state.half * halfDuration;
        standby.dataset.preparedHalf = String(state.half);
    }

    function promote(next, startedAt) {
        const prev = active;
        active = next;
        standby = prev;
        setVisible(active);
        prev.pause();
        switching = false;
        if (startedAt) {
            const measured = (performance.now() - startedAt) / 1000;
            seekLead = Math.min(1, 0.7 * seekLead + 0.3 * measured);
        }
        prepareStandby();
    }

    // Lleva el video de atrás al punto exacto que marca el reloj y lo pone al frente
    function switchToTarget() {
        if (!ready() || playBlocked) return;
        const id = ++switchId;
        switching = true;
        switchStartedAt = performance.now();
        const next = standby;
        const base = state.half * halfDuration;
        let pos = currentTarget() - base + seekLead;
        if (pos >= halfDuration) pos -= halfDuration;
        const startedAt = performance.now();
        next.dataset.preparedHalf = '';
        next.currentTime = base + pos;
        next.addEventListener('seeked', () => {
            if (id !== switchId) return;
            tryPlay(next).then(() => {
                if (id !== switchId) return;
                promote(next, startedAt);
                log(`Cambio a mitad ${state.half} (seek ${(performance.now() - startedAt).toFixed(0)} ms)`);
            }).catch(() => { if (id === switchId) switching = false; });
        }, { once: true });
    }

    // Relevo al final de la mitad: el video de atrás ya está en el segundo 0 de la mitad
    function watchBoundary() {
        requestAnimationFrame(watchBoundary);
        if (!ready() || switching || playBlocked) return;
        const end = (state.half + 1) * halfDuration;
        if (active.currentTime < end - BOUNDARY_MARGIN_S && !active.ended) return;
        if (standby.dataset.preparedHalf === String(state.half) && !standby.seeking) {
            const id = ++switchId;
            switching = true;
            switchStartedAt = performance.now();
            const next = standby;
            tryPlay(next).then(() => {
                if (id === switchId) promote(next);
            }).catch(() => { if (id === switchId) switching = false; });
        } else {
            switchToTarget();
        }
    }

    // Corrección suave de la deriva: ajusta la velocidad; si el desfase es grande, hace seek
    function correct() {
        // Si un cambio quedó colgado (un seek que nunca terminó), se vuelve a intentar
        if (switching && performance.now() - switchStartedAt > 3000) {
            console.warn('Cambio de video demorado, reintentando.');
            switching = false;
            switchToTarget();
            return;
        }
        if (!ready() || switching || playBlocked) return;
        const pos = active.currentTime - state.half * halfDuration;
        if (pos < -BOUNDARY_MARGIN_S || pos > halfDuration + BOUNDARY_MARGIN_S) {
            switchToTarget(); // está en la mitad equivocada
            return;
        }
        const target = Sync.positionInHalf(serverNow(), state.epoch, halfDuration);
        lastDrift = Sync.drift(pos, target, halfDuration);
        if (Math.abs(lastDrift) > syncConfig.hardSeekThreshold) {
            log(`Desfase de ${lastDrift.toFixed(2)} s: seek`);
            switchToTarget();
            return;
        }
        active.playbackRate = Sync.playbackRateFor(lastDrift, syncConfig);
        if (active.paused) tryPlay(active).catch(() => {});
    }

    let correctionTimer = null;
    function scheduleCorrection() {
        clearInterval(correctionTimer);
        correctionTimer = setInterval(correct, syncConfig.correctionIntervalMs);
    }

    // --- Reloj ---
    const socket = io();

    function syncClock() {
        if (!socket.connected) return;
        const sentAt = Date.now();
        socket.timeout(2000).emit('timeSync', (err, serverTime) => {
            if (err || typeof serverTime !== 'number') return;
            clockSamples.push(Sync.clockSample(sentAt, serverTime, Date.now()));
            if (clockSamples.length > 10) clockSamples.shift();
            clockOffset = Sync.bestOffset(clockSamples);
        });
    }

    let clockTimer = null;
    function scheduleClockSync() {
        clearInterval(clockTimer);
        clockTimer = setInterval(syncClock, syncConfig.clockSyncIntervalMs);
    }

    // --- Servidor ---
    socket.on('connect', () => {
        log(`Conectado: ${socket.id}`);
        clockSamples = [];
        for (let i = 0; i < 5; i++) setTimeout(syncClock, i * 100);
        socket.emit('hello', { screen: SCREEN_ID });
    });

    socket.on('state', (s) => {
        if (!s || (s.half !== 0 && s.half !== 1) || typeof s.epoch !== 'number') {
            console.error('Estado inválido recibido del servidor:', s);
            return;
        }
        if (!clockSamples.length && typeof s.serverNow === 'number') clockOffset = s.serverNow - Date.now();
        if (s.sync) {
            syncConfig = { ...syncConfig, ...s.sync };
            scheduleCorrection();
            scheduleClockSync();
        }
        const changed = !state || state.half !== s.half || state.epoch !== s.epoch;
        state = { half: s.half, epoch: s.epoch };
        log(`Estado: mitad ${state.half}`);
        if (changed) switchToTarget();
    });

    socket.on('disconnect', (reason) => console.warn(`Desconectado del servidor: ${reason}`));
    socket.on('connect_error', (error) => console.warn('Error de conexión:', error.message));

    setInterval(() => {
        if (!socket.connected) return;
        socket.emit('report', {
            screen: SCREEN_ID,
            half: state ? state.half : null,
            drift: Number(lastDrift.toFixed(3)),
            rate: Number(active.playbackRate.toFixed(3)),
            playing: !active.paused,
            blocked: playBlocked,
            seekLead: Number(seekLead.toFixed(3)),
        });
    }, 2000);

    // --- Videos ---
    function onMetadata() {
        if (players.some(p => p.readyState < HTMLMediaElement.HAVE_METADATA)) return;
        halfDuration = active.duration / 2;
        log(`Duración ${active.duration.toFixed(2)} s, mitad ${halfDuration.toFixed(2)} s`);
        switchToTarget();
    }
    for (const p of players) {
        if (p.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();
        else p.addEventListener('loadedmetadata', onMetadata, { once: true });
    }

    // --- Interacción ---
    let lastToggleAt = 0;
    function onToggle(event) {
        event.preventDefault();
        const now = Date.now();
        if (now - lastToggleAt < syncConfig.toggleDebounceMs) return;
        lastToggleAt = now;
        if (playBlocked) {
            unlock();
            return;
        }
        if (socket.connected) {
            socket.emit('toggle');
        } else if (state) {
            // Sin servidor la pantalla sigue funcionando sola; al reconectar manda el servidor
            state = { ...state, half: 1 - state.half };
            switchToTarget();
        }
    }

    function unlock() {
        playBlocked = false;
        if (initialPlayButton) initialPlayButton.classList.add('hidden');
        switchToTarget();
    }

    if (overlayButton) overlayButton.addEventListener('pointerup', onToggle);
    if (initialPlayButton) initialPlayButton.addEventListener('pointerup', (e) => { e.preventDefault(); unlock(); });

    setVisible(active);
    scheduleCorrection();
    requestAnimationFrame(watchBoundary);
});
