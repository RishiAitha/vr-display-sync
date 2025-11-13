import * as cm from './clientManager.js';

// const statusDisplay = document.createElement('div');
// statusDisplay.id = 'connection-status';
// document.body.appendChild(statusDisplay);

// function updateStatus() {
//     const state = cm.getConnectionState();
//     statusDisplay.textContent = `Connection Status: ${state.state}`;
// }

cm.registerToServer('WALL')
    .then(response => {
        cm.sendMessage({
            type: 'WALL_CALIBRATION',
            message: {
                wallWidth: window.innerWidth,
                wallHeight: window.innerHeight
            }
        });
        // updateStatus();
    })
    .catch(error => {
        console.error('Failed:', error);
        // updateStatus();
    });

//cm.handleEvent('CLOSE', updateStatus);

const targetCanvas = document.createElement('canvas');
targetCanvas.id = 'target-canvas';
targetCanvas.width = window.innerWidth;
targetCanvas.height = window.innerHeight;
document.body.appendChild(targetCanvas);

const controllerStates = new Map();

function handleVRState(message) {
    // const drawingCanvas = document.getElementById(`client-canvas-${message.userID}`);
    // const ctx = drawingCanvas.getContext('2d');

    // if (!controllerStates.has(message.userID)) {
    //     controllerStates.set(message.userID, {})
    // }
    // controllerStates.get(message.userID)[message.controllerType] = message;
    
    // // draw to canvas
    // if (message.triggerButtonState == true) {
    //     ctx.fillStyle = message.controllerType == 'left' ? 'blue' : 'red';
        
    //     const dotProduct = ((message.bottomRightCorner[0] - message.topLeftCorner[0]) * (message.position.x - message.topLeftCorner[0]))
    //         + ((message.bottomRightCorner[2] - message.topLeftCorner[2]) * (message.position.z - message.topLeftCorner[2]));
    //     const screenVectorMagnitude = Math.sqrt(Math.pow((message.bottomRightCorner[0] - message.topLeftCorner[0]), 2) + Math.pow((message.bottomRightCorner[2] - message.topLeftCorner[2]), 2));
    //     const xPosition = dotProduct / screenVectorMagnitude;
    //     const yPosition = message.position.y - message.topLeftCorner[1];

    //     const canvasX = ((xPosition / message.rectXDistance) * drawingCanvas.width);
    //     const canvasY = ((-yPosition / message.rectYDistance) * drawingCanvas.height);
        
    //     ctx.beginPath();
    //     ctx.arc(canvasX, canvasY, 5, 0, Math.PI * 2);
    //     ctx.fill();
    // }

    const ctx = targetCanvas.getContext('2d');

    if (!controllerStates.has(message.userID)) {
        controllerStates.set(message.userID, {});
    }
    controllerStates.get(message.userID)[message.controllerType] = message;
    if (message.triggerButtonState == true) {
        ctx.fillStyle = message.controllerType == 'left' ? 'blue' : 'red';
        
        const dotProduct = ((message.bottomRightCorner[0] - message.topLeftCorner[0]) * (message.position.x - message.topLeftCorner[0]))
            + ((message.bottomRightCorner[2] - message.topLeftCorner[2]) * (message.position.z - message.topLeftCorner[2]));
        const screenVectorMagnitude = Math.sqrt(Math.pow((message.bottomRightCorner[0] - message.topLeftCorner[0]), 2)
            + Math.pow((message.bottomRightCorner[2] - message.topLeftCorner[2]), 2));
        const xPosition = dotProduct / screenVectorMagnitude;
        const yPosition = message.position.y - message.topLeftCorner[1];

        const canvasX = ((xPosition / message.rectXDistance) * targetCanvas.width);
        const canvasY = ((-yPosition / message.rectYDistance) * targetCanvas.height);
        
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function handleNewClient(message) {
    const { type, userID } = message;

    if (type === 'VR') {
        console.log('new vr client');
        cm.sendMessage({
            type: 'WALL_CALIBRATION', 
            message: {
                wallWidth: window.innerWidth,
                wallHeight: window.innerHeight
            }
        });

        // const clientDiv = document.createElement('div');
        // clientDiv.id = `client-${userID}`;

        // const clientInfoDisplay = document.createElement('div');
        // clientInfoDisplay.id = `client-display-${userID}`;
        // clientInfoDisplay.textContent = `\n\nClient Type: ${type}\nClient ID: ${userID}`;
        // clientInfoDisplay.style.whiteSpace = 'pre-line';  

        // document.body.appendChild(clientDiv);
        // clientDiv.appendChild(clientInfoDisplay);
    }
}

// function handleVRCalibration(message) {
//     const { userID, rectXDistance, rectYDistance } = message;

//     const clientDiv = document.getElementById(`client-${userID}`);
    
//     const drawingCanvas = document.createElement('canvas');
//     drawingCanvas.id = `client-canvas-${userID}`;

//     const maxWidth = window.innerWidth * 0.95;
//     const maxHeight = window.innerHeight * 0.95;
//     const canvasScale = Math.min(maxWidth / rectXDistance, maxHeight / rectYDistance);

//     drawingCanvas.width = rectXDistance * canvasScale;
//     drawingCanvas.height = rectYDistance * canvasScale;
//     drawingCanvas.style.border = '1px solid black';
//     drawingCanvas.style.margin = 'auto';
//     drawingCanvas.style.display = 'block';

//     const canvasBreak = document.createElement('br');
//     canvasBreak.id = `client-canvasBreak-${userID}`;

//     const clearButton = document.createElement('button');
//     clearButton.id = `client-clearButton-${userID}`;
//     clearButton.textContent = 'Clear Canvas';
//     clearButton.onclick = () => {
//         const ctx = drawingCanvas.getContext('2d');
//         ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
//     }

//     clientDiv.appendChild(drawingCanvas);
//     clientDiv.appendChild(canvasBreak);
//     clientDiv.appendChild(clearButton);
//     drawingCanvas.scrollIntoView();
// }

function handleClientDisconnect(message) {
    // const { type, userID } = message;
    // const clientDiv = document.getElementById(`client-${userID}`);
    // clientDiv.remove();
}

cm.handleEvent('NEW_CLIENT', handleNewClient);
cm.handleEvent('CLIENT_DISCONNECTED', handleClientDisconnect);
cm.handleEvent('VR_CONTROLLER_STATE', handleVRState);