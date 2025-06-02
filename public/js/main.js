// public/js/main.js
document.addEventListener('DOMContentLoaded', () => {
    if (typeof LOCAL_VIDEO_LOGICAL_ID === 'undefined' || typeof LOCAL_VIDEO_ELEMENT_ID === 'undefined') {
        console.error('IDs de video no definidos en el HTML (LOCAL_VIDEO_LOGICAL_ID o LOCAL_VIDEO_ELEMENT_ID).');
        // alert('Error de configuración: IDs de video no definidos.'); // Podría ser intrusivo
        return;
    }

    const localVideo = document.getElementById(LOCAL_VIDEO_ELEMENT_ID);
    const overlayButton = document.querySelector('.overlay-button');
    const initialPlayButton = document.getElementById('initialPlayButton');

    if (!localVideo) {
        console.error(`Elemento de video con ID '${LOCAL_VIDEO_ELEMENT_ID}' no encontrado.`);
        return;
    }
    if (!overlayButton) {
        console.error("Elemento '.overlay-button' no encontrado.");
        // No es crítico para la funcionalidad base si initialPlayButton funciona
    }
    if (!initialPlayButton) {
        console.error("Elemento '#initialPlayButton' no encontrado.");
        // Podría ser un problema si es la única forma de iniciar el video
    }

    console.log(`Pantalla configurada para video lógico: ${LOCAL_VIDEO_LOGICAL_ID}`);

    const socket = io();
    let isProgrammaticChange = false;

    socket.on('connect', () => {
        console.log(`Conectado al servidor Socket.IO con id: ${socket.id}`);
        socket.emit('registerScreen', { logicalVideoId: LOCAL_VIDEO_LOGICAL_ID });
    });

    socket.on('videoAction', (data) => {
        if (!data || !data.action || typeof data.time !== 'number' || !data.logicalVideoId) {
            console.error("VideoAction inválida recibida del servidor:", data);
            return;
        }
        const targetTime = parseFloat(data.time);
        console.log(`[Remoto] Acción '${data.action}' en t=${targetTime.toFixed(2)} (originada por ${data.logicalVideoId}). Aplicando a ${LOCAL_VIDEO_LOGICAL_ID}.`);
        
        isProgrammaticChange = true;
        try {
            if (data.action === 'play') {
                if (Math.abs(localVideo.currentTime - targetTime) > 0.5 || localVideo.paused) {
                     if (!localVideo.seeking) localVideo.currentTime = targetTime;
                }
                localVideo.play().catch(e => console.warn("Error al reproducir (remoto):", e));
                if (initialPlayButton && !initialPlayButton.classList.contains('hidden')) {
                    initialPlayButton.classList.add('hidden');
                }
            } else if (data.action === 'pause') {
                if (Math.abs(localVideo.currentTime - targetTime) > 0.5) {
                    if (!localVideo.seeking) localVideo.currentTime = targetTime;
                }
                localVideo.pause();
            } else if (data.action === 'seek') {
                if (Math.abs(localVideo.currentTime - targetTime) > 0.3 && !localVideo.seeking) {
                    localVideo.currentTime = targetTime;
                }
            }
        } finally {
            setTimeout(() => { isProgrammaticChange = false; }, 70);
        }
    });

    socket.on('requestCurrentState', (data) => {
        if (!data || !data.requestingSocketId) {
            console.error("requestCurrentState inválido:", data);
            return;
        }
        console.log(`Servidor pide estado actual para ${data.requestingSocketId}`);
        const currentState = { time: localVideo.currentTime, paused: localVideo.paused };
        socket.emit('sendCurrentState', { state: currentState, targetSocketId: data.requestingSocketId });
    });

    socket.on('applyInitialState', (data) => {
        if (!data || !data.state || typeof data.state.time !== 'number' || typeof data.state.paused !== 'boolean') {
            console.error("applyInitialState inválido:", data);
            return;
        }
        console.log(`[Remoto] Aplicando estado inicial (desde maestro: ${data.fromMaster}): T=${data.state.time.toFixed(2)}, Pausado=${data.state.paused}`);
        isProgrammaticChange = true;
        try {
            const applyStateLogic = () => {
                isProgrammaticChange = true; // Re-asegurar
                const targetTime = parseFloat(data.state.time);

                if (Math.abs(localVideo.currentTime - targetTime) > 0.5 || localVideo.paused !== data.state.paused) {
                    localVideo.currentTime = targetTime;
                }

                if (data.state.paused) {
                    localVideo.pause();
                    if (initialPlayButton) { // Lógica para el botón de play inicial
                        // Mostrar si está pausado en t=0 y no vino de un maestro (es el primer cliente)
                        // O si vino de un maestro que también está pausado en t=0 (raro, pero posible)
                        if (targetTime < 0.1 && !data.state.fromMasterPlaying) { // (necesitaríamos un flag 'fromMasterPlaying')
                             // Simplificamos: si está pausado y el tiempo es casi 0, mostrar botón
                            if (targetTime < 0.1) initialPlayButton.classList.remove('hidden');
                            else initialPlayButton.classList.add('hidden'); // Ocultar si está pausado pero no al inicio
                        } else {
                            initialPlayButton.classList.add('hidden');
                        }
                    }
                } else { // Si no está pausado (debe reproducir)
                    localVideo.play().catch(e => console.warn("Error al reproducir (estado inicial):", e));
                    if (initialPlayButton) initialPlayButton.classList.add('hidden');
                }
                setTimeout(() => { isProgrammaticChange = false; }, 70);
            };

            if (localVideo.readyState >= HTMLMediaElement.HAVE_METADATA || data.state.time === 0) {
                applyStateLogic();
            } else {
                localVideo.addEventListener('loadedmetadata', function onLoadedMetadata() {
                    applyStateLogic();
                    localVideo.removeEventListener('loadedmetadata', onLoadedMetadata); // Limpiar listener
                });
            }
        } catch (e) {
             console.error("Error en applyInitialState:", e);
             isProgrammaticChange = false;
        }
    });

    socket.on('disconnect', (reason) => console.log(`Desconectado del servidor Socket.IO: ${reason}`));
    socket.on('connect_error', (error) => console.error('Error de conexión Socket.IO:', error));

    function sendVideoEventToServer(actionType) {
        if (isProgrammaticChange) return;
        if (typeof localVideo.currentTime !== 'number') {
            console.warn("sendVideoEventToServer: currentTime no es un número, no enviando evento.");
            return;
        }
        const eventData = {
            action: actionType,
            time: localVideo.currentTime,
            logicalVideoId: LOCAL_VIDEO_LOGICAL_ID
        };
        console.log(`Enviando acción local '${eventData.action}' en t=${eventData.time.toFixed(2)} para ${eventData.logicalVideoId}`);
        socket.emit('videoAction', eventData);
    }

    localVideo.addEventListener('play', () => sendVideoEventToServer('play'));
    localVideo.addEventListener('pause', () => sendVideoEventToServer('pause'));
    localVideo.addEventListener('seeked', () => sendVideoEventToServer('seek'));

    if (initialPlayButton) {
        initialPlayButton.addEventListener('click', () => {
            console.log('Botón de Play Inicial presionado.');
            localVideo.play().then(() => {
                console.log('Reproducción iniciada por el botón inicial.');
                initialPlayButton.classList.add('hidden');
                // El evento 'play' del video se encargará de llamar a sendVideoEventToServer
            }).catch(e => {
                console.error("Error al intentar reproducir con el botón inicial:", e);
                alert("No se pudo iniciar el video. Verifica los permisos del navegador o actualiza la página.");
            });
        });
    }

    if (overlayButton) {
        overlayButton.addEventListener('click', () => {
            if (initialPlayButton && !initialPlayButton.classList.contains('hidden')) {
                console.log("Botón de play inicial todavía visible, no ejecutar salto. Clickea el botón de play primero.");
                // Opcionalmente, hacer que este click también funcione como el initialPlayButton si está visible
                // initialPlayButton.click(); 
                return;
            }

            if (localVideo.readyState < HTMLMediaElement.HAVE_METADATA || isNaN(localVideo.duration) || localVideo.duration === Infinity) {
                console.warn("Metadatos/Duración del video no disponibles para el salto.");
                return;
            }
            const jumpAmount = localVideo.duration / 2;
            let newTime = localVideo.currentTime + jumpAmount;

            if (newTime >= localVideo.duration) {
                newTime = localVideo.duration - 0.01; // Ir casi al final para evitar problemas
                if (newTime < 0) newTime = 0; // En caso de que la duración sea extremadamente corta
            }
            
            console.log(`Botón de salto. Tiempo actual: ${localVideo.currentTime.toFixed(2)}, Duración: ${localVideo.duration.toFixed(2)}, Salto: ${jumpAmount.toFixed(2)}, Nuevo Tiempo: ${newTime.toFixed(2)}`);
            localVideo.currentTime = newTime; // Esto disparará el evento 'seeked'
            if (localVideo.paused) { // Si estaba pausado, que siga reproduciendo desde el nuevo punto
                localVideo.play().catch(e => console.warn("Error al intentar reproducir después del salto:", e));
                // El evento 'play' también llamará a sendVideoEventToServer
            }
        });
    }
});