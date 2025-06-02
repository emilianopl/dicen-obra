// video-sync-app/server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para la página de inicio/menú
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Guardar sockets conectados y su tipo de video lógico
const connectedSockets = new Map(); // socket.id -> { logicalVideoId: 'videoA' or 'videoB' }

io.on('connection', (socket) => {
    console.log(`Nuevo cliente conectado: ${socket.id}`);

    socket.on('registerScreen', (data) => {
        if (!data || !data.logicalVideoId) {
            console.error(`Registro inválido de socket ${socket.id}: datos faltantes.`);
            return;
        }
        connectedSockets.set(socket.id, { logicalVideoId: data.logicalVideoId });
        console.log(`Socket ${socket.id} registrado para ${data.logicalVideoId}. Total conectados: ${connectedSockets.size}`);

        // Sincronización inicial
        if (connectedSockets.size > 1) {
            let masterSocketId = null;
            // Encontrar cualquier otro socket que no sea el actual para pedir estado
            for (const [id] of connectedSockets) {
                if (id !== socket.id) {
                    masterSocketId = id;
                    break;
                }
            }
            if (masterSocketId) {
                console.log(`Pidiendo estado a ${masterSocketId} para nuevo socket ${socket.id}`);
                io.to(masterSocketId).emit('requestCurrentState', {
                    requestingSocketId: socket.id
                });
            }
        } else {
            // Si es el primer cliente, enviar estado pausado en t=0
            socket.emit('applyInitialState', {
                state: { time: 0, paused: true },
                fromMaster: false
            });
            console.log(`Enviando estado por defecto (pausado) a primer cliente ${socket.id}`);
        }
    });

    socket.on('sendCurrentState', (data) => {
        // data = { state: { time: ..., paused: ... }, targetSocketId: 'id_del_socket_que_pidio' }
        if (!data || !data.targetSocketId || !data.state) {
            console.error(`sendCurrentState inválido de socket ${socket.id}: datos faltantes.`);
            return;
        }
        const senderInfo = connectedSockets.get(socket.id);
        console.log(`Estado recibido de ${socket.id} (${senderInfo?.logicalVideoId || 'desconocido'}) para ${data.targetSocketId}:`, data.state);
        io.to(data.targetSocketId).emit('applyInitialState', {
            state: data.state,
            fromMaster: true
        });
    });

    socket.on('videoAction', (data) => {
        // data = { action: 'play'/'pause'/'seek', time: ..., logicalVideoId: 'videoA' o 'videoB' que originó }
        if (!data || !data.action || typeof data.time !== 'number' || !data.logicalVideoId) {
            console.error(`videoAction inválida de socket ${socket.id}: datos faltantes o incorrectos.`);
            return;
        }
        const originatorInfo = connectedSockets.get(socket.id);
        const timeDisplay = typeof data.time === 'number' ? data.time.toFixed(2) : 'N/A';
        console.log(`Acción '${data.action}' en t=${timeDisplay} originada por ${data.logicalVideoId} (socket ${socket.id}, tipo ${originatorInfo?.logicalVideoId || 'desconocido'})`);
        
        // Reenviar a todos los OTROS clientes
        socket.broadcast.emit('videoAction', data);
    });

    socket.on('disconnect', () => {
        const clientInfo = connectedSockets.get(socket.id);
        if (clientInfo) {
            console.log(`Socket ${socket.id} (${clientInfo.logicalVideoId}) desconectado.`);
            connectedSockets.delete(socket.id);
        } else {
            console.log(`Socket ${socket.id} desconectado (no registrado o ya eliminado).`);
        }
        console.log(`Total conectados: ${connectedSockets.size}`);
    });

    socket.on('error', (error) => {
        console.error(`Error en socket ${socket.id}:`, error);
    });
});

// Rutas para las pantallas de video
// Pero es bueno tenerlas por si se accede directamente.
app.get('/screen1', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen1.html')));
app.get('/screen2', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen2.html')));

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`Servidor Socket.IO corriendo en http://localhost:${PORT}`);
    console.log(`Accede a la aplicación en http://localhost:${PORT}`);
});