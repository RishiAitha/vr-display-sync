import * as cm from './clientManager.js';

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

const clearButton = document.createElement('button');
clearButton.textContent = 'Clear Canvas';
clearButton.style.position = 'absolute';
clearButton.style.bottom = '20px';
clearButton.style.left = '20px';
clearButton.style.padding = '10px 20px';
clearButton.style.fontSize = '16px';
clearButton.style.zIndex = '1000';
clearButton.style.cursor = 'pointer';
clearButton.onclick = () => {
    const ctx = targetCanvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
};
document.body.appendChild(clearButton);

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
    const ctx = targetCanvas.getContext('2d');

    if (!controllerStates.has(message.userID)) {
        controllerStates.set(message.userID, {});
    }
    controllerStates.get(message.userID)[message.controllerType] = message;

    console.log('Wall received VR state:', {
        controller: message.controllerType,
        canvasX: message.canvasX,
        canvasY: message.canvasY,
        trigger: message.triggerButtonState,
        userID: message.userID
    });

    const canvasX = message.canvasX;
    const canvasY = message.canvasY;
    if (canvasX == null || canvasY == null || isNaN(canvasX) || isNaN(canvasY)) return;

    if (message.triggerButtonState > 0.1) {
        ctx.fillStyle = message.controllerType === 'right' ? 'blue' : 'red';
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 5, 0, Math.PI * 2);
        ctx.fill();
    }
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