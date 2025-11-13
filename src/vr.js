import * as THREE from 'three';
import { init } from './init.js';
import * as cm from './clientManager.js';
import { XR_BUTTONS, XR_AXES } from 'gamepad-wrapper';
import { Text } from 'troika-three-text';

// Redirect to desktop if XR not supported
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (!supported) window.location.href = '/desktop';
    });
} else {
    window.location.href = '/desktop';
}

// Scene objects
let floor;
let screenRect;
let statusDisplay;
const EYE_HEIGHT = 1.6;

// Wall calibration data (received from wall client)
let wallHeight = null;
let wallWidth = null;
let aspectRatio = null;

// User-defined calibration points
let topLeftCorner = null;
let bottomRightCorner = null;
let rectXDistance = null;
let rectYDistance = null;

// Calibration state
let calibrated = false;
let sceneVar = null;

// Initialize scene with floor and status display
function setupScene({ scene, camera, renderer, player, controllers }) {
    sceneVar = scene;
    
    // Add floor plane
    const floorGeometry = new THREE.PlaneGeometry(6, 6);
    const floorMaterial = new THREE.MeshBasicMaterial({color: 'black', transparent: true, opacity: 0.5 });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotateX(-Math.PI / 2);
    floor.position.y = -EYE_HEIGHT;
    scene.add(floor);

    // Add status text display
    statusDisplay = new Text();
    statusDisplay.anchorX = 'center';
    statusDisplay.anchorY = 'middle';
    statusDisplay.fontSize = 0.25;
    scene.add(statusDisplay);
    statusDisplay.position.set(0, 0.5, -1.5);
}

// Main frame loop - handles calibration and drawing
async function onFrame(delta, time, {scene, camera, renderer, player, controllers}) {
    const controllerConfigs = [controllers.right, controllers.left];

    // Update status display based on calibration state
    if (!calibrated) {
        if (!aspectRatio) {
            statusDisplay.text = 'Waiting for wall connection...';
        } else if (!topLeftCorner) {
            statusDisplay.text = 'Pull trigger to set top-left corner';
        } else if (!bottomRightCorner) {
            statusDisplay.text = 'Pull trigger to set bottom-right corner';
        }
        statusDisplay.sync();
    } else {
        statusDisplay.text = 'Calibrated - drawing enabled';
        statusDisplay.sync();
    }

    // Process each controller
    for (let i = 0; i < 2; i++) {
        const controller = controllerConfigs[i];
        if (controller) {
            const { gamepad, rayspace, gripSpace, mesh } = controller;
            
            if (calibrated) {
                // Send controller state to wall for drawing
                sendVRState(i, controller);
            } else {
                // Handle calibration corner selection
                if (gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
                    if (!aspectRatio) continue; // Wait for wall connection
                    
                    if (topLeftCorner == null) {
                        topLeftCorner = [gripSpace.position.x, gripSpace.position.y, gripSpace.position.z];
                    } else if (bottomRightCorner == null) {
                        bottomRightCorner = [gripSpace.position.x, gripSpace.position.y, gripSpace.position.z];
                        calibrated = true;
                        addScreenRect(scene);
                    }
                }
            }
        }
    }
}

// Create visual rectangle aligned with calibrated corners
function addScreenRect(scene) {
    // Calculate rotation based on corner positions
    const directionX = bottomRightCorner[0] - topLeftCorner[0];
    const directionZ = bottomRightCorner[2] - topLeftCorner[2];
    const angle = Math.atan2(directionZ, directionX);

    // Calculate dimensions maintaining wall's aspect ratio
    const cornerDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);
    rectXDistance = cornerDistance;
    rectYDistance = cornerDistance / aspectRatio;
    
    // Create semi-transparent rectangle
    const screenRectGeometry = new THREE.PlaneGeometry(rectXDistance, rectYDistance);
    const screenRectMaterial = new THREE.MeshBasicMaterial({ 
        color: 'white', 
        transparent: true, 
        opacity: 0.2, 
        side: THREE.DoubleSide 
    });
    screenRect = new THREE.Mesh(screenRectGeometry, screenRectMaterial);
    scene.add(screenRect);
    
    // Position at center between corners with proper rotation
    screenRect.position.set(
        topLeftCorner[0] + (rectXDistance / 2) * Math.cos(angle),
        topLeftCorner[1] - (rectYDistance / 2),
        topLeftCorner[2] + (rectXDistance / 2) * Math.sin(angle)
    );
    screenRect.rotateY(-angle);
}

// Update connection status display
function updateStatus() {
    const state = cm.getConnectionState();
    statusDisplay.text = `Connection Status: ${state.state}`;
    statusDisplay.sync();
}

// Send controller state to wall server
async function sendVRState(i, { gamepad, rayspace, gripSpace, mesh }) {
    if (!calibrated) return;
    
    cm.sendMessage({
        type: 'VR_CONTROLLER_STATE',
        message: {
            controllerType: i == 0 ? 'right' : 'left',
            position: gripSpace.position,
            quaternion: gripSpace.quaternion,
            topLeftCorner,
            bottomRightCorner,
            rectXDistance,
            rectYDistance,
            triggerButtonState: gamepad.getButton(XR_BUTTONS.TRIGGER),
            squeezeButtonState: gamepad.getButton(XR_BUTTONS.SQUEEZE),
            touchpadButtonState: gamepad.getButton(XR_BUTTONS.TOUCHPAD),
            thumbstickButtonState: gamepad.getButton(XR_BUTTONS.THUMBSTICK),
            button1State: gamepad.getButton(XR_BUTTONS.BUTTON_1),
            button2State: gamepad.getButton(XR_BUTTONS.BUTTON_2),
            touchpadXAxisState: gamepad.getAxis(XR_AXES.TOUCHPAD_X),
            touchpadYAxisState: gamepad.getAxis(XR_AXES.TOUCHPAD_Y),
            thumbstickXAxisState: gamepad.getAxis(XR_AXES.THUMBSTICK_X),
            thumbstickYAxisState: gamepad.getAxis(XR_AXES.THUMBSTICK_Y)
        }
    });
}

// Receive wall dimensions and calculate aspect ratio
function handleCalibration(message) {
    if (calibrated) return;
    wallWidth = message.wallWidth;
    wallHeight = message.wallHeight;
    aspectRatio = wallWidth / wallHeight;
}

// Reset calibration when wall disconnects
function resetCalibration(message) {
    calibrated = false;
    if (screenRect) {
        sceneVar.remove(screenRect);
        screenRect = null;
    }
    topLeftCorner = null;
    bottomRightCorner = null;
    rectXDistance = null;
    rectYDistance = null;
}

// Register as VR client
cm.registerToServer('VR')
    .then(response => {
        updateStatus();
    })
    .catch(error => {
        console.error('Failed to register:', error);
        updateStatus();
    });

// Register event handlers
cm.handleEvent('CLOSE', updateStatus);
cm.handleEvent('WALL_CALIBRATION', handleCalibration);
cm.handleEvent('WALL_DISCONNECTED', resetCalibration);

// Initialize XR scene
init(setupScene, onFrame);