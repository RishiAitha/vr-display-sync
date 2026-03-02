import * as cm from './clientManager.js';
import * as gameAPI from './gameAPI.js';
import game from './game.js';
import paintGame from './paintGame.js';
import drawGame from './drawGame.js';
gameAPI.registerGames({ balls: game, paint: paintGame, draw: drawGame });

document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';

cm.registerToServer('SCREEN')
    .then(() => {
        sendScreenCalibration();
        // Start the screen-side game (if provided)
        try {
            const startCtx = { canvas: targetCanvas, sendGameMessage: gameAPI.sendGameMessage, committedCalibration };
            lastGameScreenContext = startCtx;
            gameAPI.setActiveGame(configActiveGameId, { screenContext: lastGameScreenContext });
            gameAPI.startScreen(startCtx);
        } catch (e) {
            console.error('gameAPI startScreen error', e);
        }
    })
    .catch(error => {
        console.error('Failed to register:', error);
    });

const targetCanvas = document.createElement('canvas');
targetCanvas.id = 'target-canvas';
targetCanvas.width = window.innerWidth;
targetCanvas.height = window.innerHeight;
targetCanvas.style.backgroundColor = 'white';
document.body.appendChild(targetCanvas);

function resizeCanvasToWindow() {
    targetCanvas.width = window.innerWidth;
    targetCanvas.height = window.innerHeight;
}

function sendScreenCalibration() {
    resizeCanvasToWindow();
    cm.sendMessage({
        type: 'SCREEN_CALIBRATION',
        message: {
            screenWidth: targetCanvas.width,
            screenHeight: targetCanvas.height
        }
    });
}

let __resizeRaf = null;
window.addEventListener('resize', () => {
    if (__resizeRaf) return;
    __resizeRaf = requestAnimationFrame(() => {
        __resizeRaf = null;
        try { sendScreenCalibration(); } catch (e) { /* ignore */ }
    });
});

const targetImage = new Image();
targetImage.src = '/assets/target.png';

let committedCalibration = null;

let configActiveGameId = 'balls';
let lastGameScreenContext = null;

function handleNewClient(message) {
    const { type, userID } = message;
    if (type === 'VR') {
        console.log('New VR client connected:', userID);
        sendScreenCalibration();
    }
}

function handleClientDisconnect(message) {
    const { userID } = message;
    console.log('Client disconnected:', userID);
}

cm.handleEvent('NEW_CLIENT', handleNewClient);
cm.handleEvent('CLIENT_DISCONNECTED', handleClientDisconnect);
cm.handleEvent('CONFIG_UPDATE', (message) => {
    if (message && typeof message.activeGameId === 'string') {
        const nextId = message.activeGameId;
        if (nextId && nextId !== configActiveGameId) {
            configActiveGameId = nextId;
            gameAPI.setActiveGame(nextId, { screenContext: lastGameScreenContext });
            if (lastGameScreenContext) {
                try { void gameAPI.startScreen(lastGameScreenContext); } catch (e) { console.error('gameAPI startScreen error', e); }
            }
        }
    }
    if (message && typeof message.swipeForceMultiplier === 'number' && Number.isFinite(message.swipeForceMultiplier)) {
        game.swipeForceMultiplier = message.swipeForceMultiplier;
    }
    if (message && typeof message.gravityMultiplier === 'number' && Number.isFinite(message.gravityMultiplier)) {
        game.gravityMultiplier = message.gravityMultiplier;
    } else if (message && typeof message.gravityPixelsPerSec2 === 'number' && Number.isFinite(message.gravityPixelsPerSec2)) {
        game.gravityMultiplier = message.gravityPixelsPerSec2 / 980;
    }
});
cm.handleEvent('CALIBRATION_COMMIT', (message) => {
    console.log('Screen received CALIBRATION_COMMIT (ignored overlay):', message);
    committedCalibration = message;
});

// Optional per-frame screen update (no-op if game doesn't implement it)
let __lastScreenTime = performance.now();
function __screenTick(t) {
    const delta = (t - __lastScreenTime) / 1000;
    __lastScreenTime = t;
    try { gameAPI.updateScreen(delta, t / 1000, { canvas: targetCanvas, sendGameMessage: gameAPI.sendGameMessage }); } catch (e) { /* ignore */ }
    requestAnimationFrame(__screenTick);
}
requestAnimationFrame(__screenTick);