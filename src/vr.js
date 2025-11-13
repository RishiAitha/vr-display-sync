import * as THREE from 'three';
import { init } from './init.js';
import * as cm from './clientManager.js';
import { XR_BUTTONS, XR_AXES } from 'gamepad-wrapper';
import { Text } from 'troika-three-text';

if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (!supported) window.location.href = '/desktop';
    });
} else {
    window.location.href = '/desktop';
}

let floor;
let screenRect;
let statusDisplay;
const EYE_HEIGHT = 1.6;
let wallHeight = null;
let wallWidth = null;
let aspectRatio = null;
let topLeftCorner = null;
let bottomRightCorner = null;
let rectXDistance = null;
let rectYDistance = null;

let calibrated = false;
let sceneVar = null;

function setupScene({ scene, camera, renderer, player, controllers }) {
    sceneVar = scene;
    const floorGeometry = new THREE.PlaneGeometry(6, 6);
    const floorMaterial = new THREE.MeshBasicMaterial({color: 'black', transparent: true, opacity: 0.5 });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotateX(-Math.PI / 2);
    floor.position.y = -EYE_HEIGHT;
    scene.add(floor);

    statusDisplay = new Text();
    statusDisplay.anchorX = 'center';
    statusDisplay.anchorY = 'middle';
    statusDisplay.fontSize = 0.25;
    scene.add(statusDisplay);
    statusDisplay.position.set(0, 0.5, -1.5);
}

async function onFrame(delta, time, {scene, camera, renderer, player, controllers}) {
    // make changes here
    const controllerConfigs = [controllers.right, controllers.left];

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

    for (let i = 0; i < 2; i++) {
        const controller = controllerConfigs[i];
        if (controller) {
            const { gamepad, rayspace, gripSpace, mesh } = controller;
            if (calibrated) {
                sendVRState(i, controller);
            } else {
                if (gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
                    if (!aspectRatio) {
                        continue;
                    }
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

function addScreenRect(scene) {
    const directionX = bottomRightCorner[0] - topLeftCorner[0];
    const directionZ = bottomRightCorner[2] - topLeftCorner[2];
    const angle = Math.atan2(directionZ, directionX);

    const cornerDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);

    rectXDistance = cornerDistance;
    rectYDistance = cornerDistance / aspectRatio;
    const screenRectGeometry = new THREE.PlaneGeometry(rectXDistance, rectYDistance);
    const screenRectMaterial = new THREE.MeshBasicMaterial({ color: 'white', transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    screenRect = new THREE.Mesh(screenRectGeometry, screenRectMaterial);
    scene.add(screenRect);
    screenRect.position.set(
        topLeftCorner[0] + (rectXDistance / 2) * Math.cos(angle),
        topLeftCorner[1] - (rectYDistance / 2),
        topLeftCorner[2] + (rectXDistance / 2) * Math.sin(angle)
    );

    screenRect.rotateY(-angle);
}

function updateStatus() {
    const state = cm.getConnectionState();
    statusDisplay.text = `Connection Status: ${state.state}`;
    statusDisplay.sync();
}

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

function handleCalibration(message) {
    console.log(calibrated);
    if (calibrated) return;
    wallWidth = message.wallWidth;
    wallHeight = message.wallHeight;
    aspectRatio = wallWidth / wallHeight;
}

function resetCalibration(message) {
    calibrated = false;
    sceneVar.remove(screenRect);
    screenRect = null;
    topLeftCorner = null;
    bottomRightCorner = null;
    rectXDistance = null;
    rectYDistance = null;
}

cm.registerToServer('VR')
    .then(response => {
        updateStatus();
    })
    .catch(error => {
        console.error('Failed:', error);
        updateStatus();
    });

cm.handleEvent('CLOSE', updateStatus);

cm.handleEvent('WALL_CALIBRATION', handleCalibration);
cm.handleEvent('WALL_DISCONNECTED', resetCalibration);

init(setupScene, onFrame);