import * as cm from './clientManager.js';

// Register as wall client and send calibration info
cm.registerToServer('WALL')
    .then(response => {
        // Send wall dimensions to any connected VR clients
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

// Create fullscreen canvas for drawing
const targetCanvas = document.createElement('canvas');
targetCanvas.id = 'target-canvas';
targetCanvas.width = window.innerWidth;
targetCanvas.height = window.innerHeight;
document.body.appendChild(targetCanvas);

// Store controller state for each connected user
const controllerStates = new Map();

// Handle incoming VR controller state and draw to canvas
function handleVRState(message) {
    const ctx = targetCanvas.getContext('2d');

    // Track controller state
    if (!controllerStates.has(message.userID)) {
        controllerStates.set(message.userID, {});
    }
    controllerStates.get(message.userID)[message.controllerType] = message;
    
    // Project 3D VR position to 2D canvas coordinates
    // Calculate X position using dot product with screen direction vector
    const dotProduct = ((message.bottomRightCorner[0] - message.topLeftCorner[0]) * (message.position.x - message.topLeftCorner[0]))
        + ((message.bottomRightCorner[2] - message.topLeftCorner[2]) * (message.position.z - message.topLeftCorner[2]));
    const screenVectorMagnitude = Math.sqrt(
        Math.pow((message.bottomRightCorner[0] - message.topLeftCorner[0]), 2)
        + Math.pow((message.bottomRightCorner[2] - message.topLeftCorner[2]), 2)
    );
    const xPosition = dotProduct / screenVectorMagnitude;
    const yPosition = message.position.y - message.topLeftCorner[1];

    // Convert to canvas pixel coordinates
    const canvasX = ((xPosition / message.rectXDistance) * targetCanvas.width);
    const canvasY = ((-yPosition / message.rectYDistance) * targetCanvas.height);
}

// Send calibration info to newly connected VR clients
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

// Clean up when clients disconnect
function handleClientDisconnect(message) {
    const { type, userID } = message;
    if (controllerStates.has(userID)) {
        controllerStates.delete(userID);
        console.log('Client disconnected:', userID);
    }
}

// Register event handlers
cm.handleEvent('NEW_CLIENT', handleNewClient);
cm.handleEvent('CLIENT_DISCONNECTED', handleClientDisconnect);
cm.handleEvent('VR_CONTROLLER_STATE', handleVRState);