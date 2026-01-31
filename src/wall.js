import * as cm from './clientManager.js';
import * as gameAPI from './gameAPI.js';
import game from './game.js';
gameAPI.registerGame(game);

document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';

cm.registerToServer('WALL')
    .then(() => {
        cm.sendMessage({
            type: 'WALL_CALIBRATION',
            message: {
                wallWidth: window.innerWidth,
                wallHeight: window.innerHeight
            }
        });
        // Start the wall-side game (if provided)
        try { gameAPI.startWall({ canvas: targetCanvas, sendGameMessage: gameAPI.sendGameMessage, committedCalibration }); } catch (e) { console.error('gameAPI startWall error', e); }
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

const targetImage = new Image();
targetImage.src = '/assets/target.png';

// Clear button and drawing are handled by the active game (via startWall)

const controllerStates = new Map();
let committedCalibration = null;

function drawCalibrationOverlay(calib) {
    if (!calib) return;
    const ctx = targetCanvas.getContext('2d');
    const margin = 0.1;
    const widthPx = targetCanvas.width * (1 - margin * 2);
    const heightPx = widthPx * (calib.rectYDistance / calib.rectXDistance);
    const x = (targetCanvas.width - widthPx) / 2;
    const y = (targetCanvas.height - heightPx) / 2;

    ctx.save();
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.strokeStyle = 'rgba(0,128,0,0.9)';
    ctx.lineWidth = 6;
    ctx.strokeRect(x, y, widthPx, heightPx);
    ctx.restore();
}

function handleVRState(message) {
    // Forward VR controller state to the active game for drawing/processing
    try { gameAPI.onMessage({ type: 'VR_CONTROLLER_STATE', message }); } catch (e) { console.error('game onMessage error', e); }
    if (!controllerStates.has(message.userID)) controllerStates.set(message.userID, {});
    controllerStates.get(message.userID)[message.controllerType] = message;
}

function handleNewClient(message) {
    const { type, userID } = message;
    if (type === 'VR') {
        console.log('New VR client connected:', userID);
        cm.sendMessage({
            type: 'WALL_CALIBRATION',
            message: {
                wallWidth: window.innerWidth,
                wallHeight: window.innerHeight
            }
        });
    }
}

function handleClientDisconnect(message) {
    const { userID } = message;
    if (controllerStates.has(userID)) {
        controllerStates.delete(userID);
        console.log('Client disconnected:', userID);
    }
}

cm.handleEvent('NEW_CLIENT', handleNewClient);
cm.handleEvent('CLIENT_DISCONNECTED', handleClientDisconnect);
cm.handleEvent('VR_CONTROLLER_STATE', handleVRState);
cm.handleEvent('CALIBRATION_COMMIT', (message) => {
    console.log('Wall received CALIBRATION_COMMIT (ignored overlay):', message);
    committedCalibration = message;
});
cm.handleEvent('GAME_EVENT', (message) => { try { gameAPI.onMessage(message); } catch (e) { console.error('gameAPI onMessage error', e); } });

// Optional per-frame wall update (no-op if game doesn't implement it)
let __lastWallTime = performance.now();
function __wallTick(t) {
    const delta = (t - __lastWallTime) / 1000;
    __lastWallTime = t;
    try { gameAPI.updateWall(delta, t / 1000, { canvas: targetCanvas, sendGameMessage: gameAPI.sendGameMessage }); } catch (e) { /* ignore */ }
    requestAnimationFrame(__wallTick);
}
requestAnimationFrame(__wallTick);