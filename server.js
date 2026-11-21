// server.js
// El servidor es la fuente de verdad: guarda qué estado se ve (pausa o play)
// y un reloj de referencia. Las pantallas calculan su posición a partir de ese reloj,
// así que no dependen unas de otras y se corrigen solas si se desfasan o se reconectan.
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const os = require('os');
const config = require('./config');

const app = express();
const httpServer = http.createServer(app);
// Las pantallas de otras PCs se conectan desde su propia página local (otro origen)
const io = new Server(httpServer, { cors: { origin: true } });

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para la página de inicio/menú
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Estado compartido de la obra
const state = {
    half: 0,              // 0 = pausa, 1 = play (arriba/abajo en el apilado, o primera/segunda mitad)
    epoch: Date.now(),    // instante (ms) en que ambas mitades estaban en su segundo 0
    toggles: 0,
    lastToggleAt: 0,
};
const startedAt = Date.now();

// socket.id -> { screen, connectedAt, report }
const screens = new Map();

function publicState() {
    return { half: state.half, epoch: state.epoch, serverNow: Date.now(), sync: config.sync };
}

io.on('connection', (socket) => {
    socket.on('hello', (data) => {
        const screen = data && typeof data.screen === 'string' ? data.screen : 'desconocida';
        screens.set(socket.id, { screen, connectedAt: Date.now(), report: null });
        console.log(`Pantalla conectada: ${screen} (${socket.id}). Total: ${screens.size}`);
        socket.emit('state', publicState());
    });

    // Medición de reloj: el cliente manda la hora local y recibe la del servidor
    socket.on('timeSync', (ack) => {
        if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('toggle', () => {
        const now = Date.now();
        if (now - state.lastToggleAt < config.toggleDebounceMs) return;
        state.lastToggleAt = now;
        state.half = 1 - state.half;
        state.toggles++;
        const origin = screens.get(socket.id)?.screen || socket.id;
        console.log(`Toggle desde ${origin}: ${state.half === 1 ? 'play' : 'pausa'}`);
        io.emit('state', publicState());
    });

    // Cada pantalla informa periódicamente su desfase para la página /estado
    socket.on('report', (report) => {
        const info = screens.get(socket.id);
        if (info && report && typeof report === 'object') info.report = { ...report, at: Date.now() };
    });

    socket.on('disconnect', (reason) => {
        const info = screens.get(socket.id);
        screens.delete(socket.id);
        console.log(`Pantalla desconectada: ${info?.screen || socket.id} (${reason}). Total: ${screens.size}`);
    });
});

app.get('/api/estado', (req, res) => {
    res.json({
        half: state.half,
        toggles: state.toggles,
        lastToggleAt: state.lastToggleAt || null,
        uptimeS: Math.round((Date.now() - startedAt) / 1000),
        screens: Array.from(screens, ([id, info]) => ({ id, ...info })),
    });
});

// Rutas para las pantallas de video
app.get('/screen1', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen1.html')));
app.get('/screen2', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen2.html')));
app.get('/estado', (req, res) => res.sendFile(path.join(__dirname, 'public', 'estado.html')));

// Todas las IPv4 de la red local, con el nombre del adaptador (en Windows suele haber
// adaptadores virtuales, así que conviene ver la lista completa)
function localAddresses() {
    const result = [];
    for (const [name, nets] of Object.entries(os.networkInterfaces())) {
        for (const net of nets || []) {
            if (net.family === 'IPv4' && !net.internal) result.push({ name, address: net.address });
        }
    }
    return result;
}

httpServer.listen(config.port, () => {
    console.log(`DICEN - OBRA`);
    console.log(`Servidor Online`);
    console.log('Puedes acceder a la aplicación en tu navegador:');
    console.log(`- En esta computadora: http://localhost:${config.port}`);
    const addresses = localAddresses();
    if (addresses.length) {
        for (const { name, address } of addresses) {
            console.log(`- En otros dispositivos de la red (${name}): http://${address}:${config.port}`);
        }
    } else {
        console.log('- No se pudo detectar la IP local para otros dispositivos.');
    }
    console.log(`- Estado de la obra: http://localhost:${config.port}/estado`);
});
