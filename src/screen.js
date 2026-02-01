import * as cm from './clientManager.js';
import * as gameAPI from './gameAPI.js';
import game from './game.js';
gameAPI.registerGame(game);

document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';

cm.registerToServer('SCREEN')
    .then(() => {
        cm.sendMessage({
            type: 'SCREEN_CALIBRATION',
            message: {
                screenWidth: window.innerWidth,
                screenHeight: window.innerHeight
            }
        });
        // Start the screen-side game (if provided)
        try { gameAPI.startScreen({ canvas: targetCanvas, sendGameMessage: gameAPI.sendGameMessage, committedCalibration }); } catch (e) { console.error('gameAPI startScreen error', e); }
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

// Clear button and drawing are handled by the active game (via startScreen)

const controllerStates = new Map();
let committedCalibration = null;

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
            type: 'SCREEN_CALIBRATION',
            message: {
                screenWidth: window.innerWidth,
                screenHeight: window.innerHeight
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
    console.log('Screen received CALIBRATION_COMMIT (ignored overlay):', message);
    committedCalibration = message;
});
cm.handleEvent('GAME_EVENT', (message) => { try { gameAPI.onMessage(message); } catch (e) { console.error('gameAPI onMessage error', e); } });

// Optional per-frame screen update (no-op if game doesn't implement it)
let __lastScreenTime = performance.now();
function __screenTick(t) {
    const delta = (t - __lastScreenTime) / 1000;
    __lastScreenTime = t;
    try { gameAPI.updateScreen(delta, t / 1000, { canvas: targetCanvas, sendGameMessage: gameAPI.sendGameMessage }); } catch (e) { /* ignore */ }
    requestAnimationFrame(__screenTick);
}
requestAnimationFrame(__screenTick);