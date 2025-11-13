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
targetCanvas.style.backgroundColor = 'white';
document.body.appendChild(targetCanvas);

const targetImage = new Image();
targetImage.src = '/assets/target.png';

const activeTargets = [];

let score = 0;

let spawnInterval;
targetImage.onload = () => {
    spawnInterval = setInterval(() => {
        spawnTarget();
    }, 2000);
};

function spawnTarget() {
    const target = {
        x: Math.random() * (targetCanvas.width - 50),
        y: Math.random() * (targetCanvas.height - 50),
        size: 50,
        lifetime: 6000,
        spawnTime: Date.now()
    };
    activeTargets.push(target);
    drawTargets();
}

function drawTargets() {
    const ctx = targetCanvas.getContext('2d');

    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

    const now = Date.now();
    for (let i = activeTargets.length - 1; i >= 0; i--) {
        const target = activeTargets[i];

        if (now - target.spawnTime > target.lifetime) {
            activeTargets.splice(i, 1);
            continue;
        }

        ctx.drawImage(targetImage, target.x, target.y, target.size, target.size);
    }

    ctx.fillStyle = 'black';
    ctx.font = '40px Arial';
    ctx.fillText(`Score: ${score}`, 20, 60);
}

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

    for (let i = activeTargets.length - 1; i >= 0; i--) {
        const target = activeTargets[i];
        const xDistance = canvasX - (target.x + target.size / 2);
        const yDistance = canvasY - (target.y + target.size / 2);
        const distance = Math.sqrt(xDistance * xDistance, yDistance * yDistance);

        if (distance < target.size / 2) {
            activeTargets.splice(i, 1);
            score++;
            drawTargets();
            break;
        }
    }
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