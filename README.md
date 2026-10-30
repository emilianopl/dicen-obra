# Dicen

Aplicación de sincronización de la videoinstalación *Dicen*. Dos pantallas, una a cada lado, comparten el estado Play/Pausa: un clic en cualquiera de los dos lados cambia ambas.

## Cómo funciona

- Cada pantalla reproduce un único archivo con dos mitades de igual duración, pegadas: la primera es el estado inicial y la segunda el otro estado. El clic cambia de mitad en las dos pantallas a la vez.
- El servidor (`server.js`) es la fuente de verdad: guarda qué mitad se ve y un reloj de referencia. Cada pantalla calcula en qué segundo debería estar a partir de ese reloj, así que no depende de la otra.
- Cada pantalla tiene dos `<video>` con el mismo archivo. Uno se ve y suena; el otro espera listo atrás. El cambio de mitad y la vuelta del bucle se hacen preparando el de atrás y recién ahí intercambiándolos, para que no haya cortes ni cuadros negros.
- Cada medio segundo, cada pantalla compara su posición con la del reloj y ajusta la velocidad entre 0,95 y 1,05 para corregir la deriva. Si se desfasa más de 1 segundo, hace un seek.
- Si una pantalla pierde la conexión, sigue reproduciendo (y responde al clic por su cuenta). Al reconectarse, se pone al día sola.
- Los clics repetidos dentro de 400 ms se ignoran, tanto en la pantalla como en el servidor. Eso también resuelve el clic simultáneo de ambos lados.

## Instalación

Requiere Node.js 22 o superior.

```bash
npm install
npm start
```

Los videos no están en el repositorio. Copiarlos a `public/videos/`:

- `public/videos/video1.mp4`: pantalla 1
- `public/videos/video2.mp4`: pantalla 2

Los dos archivos tienen que durar exactamente lo mismo, y en cada uno las dos mitades también.

## Montaje

1. Elegir una de las PCs como servidor y arrancarlo con `npm start` (o `scripts/server-windows.bat`, que lo reinicia si se cierra). Al arrancar muestra las direcciones IP de la red local.
2. En cada PC, abrir su pantalla en modo kiosco:
   - Windows: `scripts\kiosk-windows.bat screen1 192.168.0.10`
   - Linux: `scripts/kiosk-linux.sh screen2 192.168.0.10`

   En la PC que corre el servidor, se puede usar `localhost`.
3. Revisar `http://<ip-del-servidor>:8080/estado`: muestra las pantallas conectadas, la mitad actual y el desfase de cada una.

Los scripts de kiosco abren Chrome con `--autoplay-policy=no-user-gesture-required`, para que el video arranque con sonido sin tocar nada. Sin esa opción, el navegador bloquea el audio y aparece un botón "Iniciar" que hay que tocar una vez.

Para arrancar todo automáticamente al prender las PCs:

- Windows: poner accesos directos a `server-windows.bat` (solo en la PC servidor) y a `kiosk-windows.bat` en la carpeta de Inicio (`Win + R`, `shell:startup`).
- Linux: instalar `scripts/dicen.service` como servicio de systemd y agregar `kiosk-linux.sh` al inicio de sesión.

Se recomienda conectar las PCs por cable o con un router dedicado, en lugar del Wi-Fi del lugar.

## Configuración

Por variables de entorno. Copiar `.env.example` a `.env` y arrancar con `node --env-file=.env server.js` (los scripts de arranque lo hacen solos si existe `.env`).

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `PORT` | 8080 | Puerto del servidor |
| `DICEN_TOGGLE_DEBOUNCE_MS` | 400 | Ventana en la que se ignoran clics repetidos |
| `DICEN_HARD_SEEK_S` | 1.0 | Desfase a partir del cual se hace seek en vez de ajustar la velocidad |
| `DICEN_DEADBAND_S` | 0.03 | Desfase que se tolera sin corregir |
| `DICEN_GAIN` | 0.5 | Cuánto se ajusta la velocidad por segundo de desfase |
| `DICEN_MAX_RATE_DELTA` | 0.05 | Ajuste máximo de velocidad (0,05 = entre 0,95 y 1,05) |
| `DICEN_CORRECTION_MS` | 500 | Cada cuánto se corrige la deriva |
| `DICEN_CLOCK_SYNC_MS` | 5000 | Cada cuánto se mide el reloj del servidor |

## Desarrollo

- `npm test` corre los tests de los cálculos de sincronización (`public/js/sync-math.js`).
- Agregar `?debug` a la URL de una pantalla (por ejemplo `/screen1?debug`) muestra en la consola cada cambio y cada corrección.
