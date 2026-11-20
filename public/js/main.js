// public/js/main.js
// Cada pantalla tiene dos <video> con el mismo archivo. Uno se ve y suena; el otro espera
// listo en segundo plano para la vuelta del bucle, que así se hace sin cortes.
//
// Dos formatos de archivo (DICEN_FORMATO en el servidor):
// - "apilado" (por defecto): imagen 1920x2160 con pausa arriba y play abajo, y audio de
//   4 canales (FL/FR = pausa, BL/BR = play). El toque no hace seek: solo cambia qué mitad
//   de la imagen se muestra y qué par de canales suena.
// - "mitades": pausa y play pegados uno después del otro; el toque salta a la otra mitad.
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
    let videoDuration = null;
    const wrapper = document.querySelector('.video-wrapper');
    const isStacked = () => syncConfig.format !== 'mitades';

    const serverNow = () => Date.now() + clockOffset;
    const ready = () => state !== null && halfDuration !== null;

    // Duración de una vuelta: el archivo entero (apilado) o la mitad (mitades)
    function updateDuration() {
        if (videoDuration === null) return;
        halfDuration = isStacked() ? videoDuration : videoDuration / 2;
    }
    // Dónde empieza la vuelta dentro del archivo para el estado actual
    const segBase = () => (isStacked() ? 0 : state.half * halfDuration);
    const preparedKey = () => (isStacked() ? 'apilado' : String(state.half));

    // --- Formato apilado: encuadre y audio ---
    // Cada <video> pasa por Web Audio: los 4 canales se separan, pausa (0-1) y play (2-3)
    // van a ganancias distintas y salen en estéreo. Las dos ganancias son compartidas.
    let audioCtx = null;
    let pauseGain = null;
    let playGain = null;
    function setupAudio() {
        if (audioCtx || !isStacked()) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) { console.warn('Sin Web Audio: se escuchan los 4 canales mezclados.'); return; }
        try {
            audioCtx = new Ctx();
            pauseGain = audioCtx.createGain();
            playGain = audioCtx.createGain();
            pauseGain.connect(audioCtx.destination);
            playGain.connect(audioCtx.destination);
            for (const p of players) {
                const source = audioCtx.createMediaElementSource(p);
                const splitter = audioCtx.createChannelSplitter(4);
                const pauseMerge = audioCtx.createChannelMerger(2);
                const playMerge = audioCtx.createChannelMerger(2);
                source.connect(splitter);
                splitter.connect(pauseMerge, 0, 0);
                splitter.connect(pauseMerge, 1, 1);
                splitter.connect(playMerge, 2, 0);
                splitter.connect(playMerge, 3, 1);
                pauseMerge.connect(pauseGain);
                playMerge.connect(playGain);
            }
            applyLook(true);
        } catch (e) {
            console.error('No se pudo armar el audio de 4 canales:', e);
        }
    }

    function resumeAudio() {
        if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
    }

    // Muestra la mitad de arriba (pausa) o la de abajo (play) y abre el par de canales que va
    function applyLook(immediate) {
        if (!wrapper) return;
        const stacked = isStacked();
        wrapper.classList.toggle('apilado', stacked);
        const play = stacked && state && state.half === 1;
        wrapper.classList.toggle('estado-play', play);
        if (!audioCtx) return;
        const t = audioCtx.currentTime;
        const tau = immediate ? 0.001 : 0.015; // fundido corto para que no haga clic
        pauseGain.gain.setTargetAtTime(play ? 0 : 1, t, tau);
        playGain.gain.setTargetAtTime(play ? 1 : 0, t, tau);
    }

    function setVisible(el) {
        for (const p of players) {
            const on = p === el;
            p.classList.toggle('visible', on);
            p.muted = !on;
        }
    }

    function tryPlay(el) {
        resumeAudio();
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
        return Sync.positionInHalf(serverNow(), state.epoch, halfDuration) + segBase();
    }

    // Deja el video de atrás en el comienzo de la mitad actual, listo para la vuelta del bucle
    function prepareStandby() {
        if (!ready()) return;
        standby.pause();
        standby.playbackRate = 1;
        standby.currentTime = segBase();
        standby.dataset.preparedHalf = preparedKey();
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
        const base = segBase();
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
                log(`Video en posición, estado ${state.half} (seek ${(performance.now() - startedAt).toFixed(0)} ms)`);
            }).catch(() => { if (id === switchId) switching = false; });
        }, { once: true });
    }

    // Relevo al final de la mitad: el video de atrás ya está en el segundo 0 de la mitad
    function watchBoundary() {
        requestAnimationFrame(watchBoundary);
        if (!ready() || switching || playBlocked) return;
        const end = segBase() + halfDuration;
        if (active.currentTime < end - BOUNDARY_MARGIN_S && !active.ended) return;
        if (standby.dataset.preparedHalf === preparedKey() && !standby.seeking) {
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
        // Audio bloqueado por el navegador (falta --autoplay-policy): se pide un toque
        if (audioCtx && audioCtx.state === 'suspended' && initialPlayButton) {
            initialPlayButton.classList.remove('hidden');
        }
        if (!ready() || switching || playBlocked) return;
        const pos = active.currentTime - segBase();
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
            updateDuration();
            setupAudio();
            scheduleCorrection();
            scheduleClockSync();
        }
        const first = !state;
        const halfChanged = !first && state.half !== s.half;
        const epochChanged = !first && state.epoch !== s.epoch;
        state = { half: s.half, epoch: s.epoch };
        log(`Estado: ${state.half === 1 ? 'play' : 'pausa'}`);
        applyLook(first);
        if (first || epochChanged || (halfChanged && !isStacked())) switchToTarget();
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
            format: isStacked() ? 'apilado' : 'mitades',
            audio: audioCtx ? audioCtx.state : 'sin web audio',
        });
    }, 2000);

    // --- Videos ---
    function onMetadata() {
        if (players.some(p => p.readyState < HTMLMediaElement.HAVE_METADATA)) return;
        videoDuration = active.duration;
        updateDuration();
        log(`Duración ${active.duration.toFixed(2)} s, vuelta ${halfDuration.toFixed(2)} s`);
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
        if (audioCtx && audioCtx.state !== 'running') {
            // El primer toque solo habilita el sonido (el navegador lo exige)
            unlock();
            return;
        }
        if (playBlocked) {
            unlock();
            return;
        }
        if (socket.connected) {
            socket.emit('toggle');
        } else if (state) {
            // Sin servidor la pantalla sigue funcionando sola; al reconectar manda el servidor
            state = { ...state, half: 1 - state.half };
            applyLook(false);
            if (!isStacked()) switchToTarget();
        }
    }

    function unlock() {
        playBlocked = false;
        resumeAudio();
        if (initialPlayButton) initialPlayButton.classList.add('hidden');
        switchToTarget();
    }

    if (overlayButton) overlayButton.addEventListener('pointerup', onToggle);
    if (initialPlayButton) initialPlayButton.addEventListener('pointerup', (e) => { e.preventDefault(); unlock(); });

    setVisible(active);
    scheduleCorrection();
    requestAnimationFrame(watchBoundary);
});
