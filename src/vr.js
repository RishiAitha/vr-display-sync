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
    for (let i = 0; i < 2; i++) {
        const controller = controllerConfigs[i];
        if (controller) {
            const { gamepad, rayspace, gripSpace, mesh } = controller;
            if (calibrated) {
                sendVRState(i, controller);
            } else {
                if (gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
                    if (topLeftCorner == null) {
                        topLeftCorner = [gripSpace.position.x, gripSpace.position.y, gripSpace.position.z];
                        console.log("top left", topLeftCorner);
                    } else if (bottomRightCorner == null) {
                        bottomRightCorner = [gripSpace.position.x, gripSpace.position.y, gripSpace.position.z];
                        console.log("bottom right", bottomRightCorner);
                        calibrated = true;
                        addScreenRect(scene);
                    }
                }
            }
        }
    }
}

function addScreenRect(scene) {
    rectXDistance = Math.abs(bottomRightCorner[0] - topLeftCorner[0]);
    rectYDistance = Math.abs(bottomRightCorner[1] - topLeftCorner[1]);
    const screenRectGeometry = new THREE.PlaneGeometry(rectXDistance, rectYDistance);
    const screenRectMaterial = new THREE.MeshBasicMaterial({ color: 'white', transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    screenRect = new THREE.Mesh(screenRectGeometry, screenRectMaterial);
    scene.add(screenRect);
    screenRect.position.set((topLeftCorner[0] + bottomRightCorner[0]) / 2, (topLeftCorner[1] + bottomRightCorner[1]) / 2, (topLeftCorner[2] + bottomRightCorner[2]) / 2);

    const angle = Math.atan2(bottomRightCorner[2] - topLeftCorner[2], bottomRightCorner[0] - topLeftCorner[0]);
    screenRect.rotateY(-angle);
    
    cm.sendMessage({
        type: 'VR_CALIBRATED',
        message: {
            topLeftCorner,
            bottomRightCorner,
            rectXDistance,
            rectYDistance
        }
    })
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

cm.handleEvent('WALL_DISCONNECTED', resetCalibration);

init(setupScene, onFrame);