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
let cornerIndicator;
let rayHelper;
let rightDrawingRayHelper; // Visual ray for right controller drawing (blue)
let leftDrawingRayHelper; // Visual ray for left controller drawing (red)
let statusDisplay;
const EYE_HEIGHT = 1.6;

// Wall calibration data (received from wall client)
let wallHeight = null;
let wallWidth = null;
let aspectRatio = null;

// User-defined calibration points (start with defaults)
let topLeftCorner = [-0.5, 1.6, -2.0];
let bottomRightCorner = [1.0, 0.8, -2.0];
let rectXDistance = null;
let rectYDistance = null;

// Calibration state
let calibrated = false;
let sceneVar = null;
let fineTuneMode = true; // Start in fine-tune mode
let selectedCorner = 'topLeft'; // or 'bottomRight'
let cornerDistance = 2.0; // Distance along ray from controller

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

    // Create corner indicator (vertical bar to represent screen edge)
    const indicatorGeometry = new THREE.CylinderGeometry(0.03, 0.03, 1, 16); // Will be scaled dynamically
    const indicatorMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffff00, 
        transparent: true, 
        opacity: 0.8
    });
    cornerIndicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
    cornerIndicator.visible = false; // Hidden until calibration starts
    scene.add(cornerIndicator);

    // Create ray helper to visualize controller direction
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -3)
    ]);
    const rayMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    rayHelper = new THREE.Line(rayGeometry, rayMaterial);
    rayHelper.visible = false;
    scene.add(rayHelper);

    // Create drawing ray helpers for each controller (right = blue, left = red)
    const rightRayGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -5)
    ]);
    const rightRayMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff }); // Blue for right
    rightDrawingRayHelper = new THREE.Line(rightRayGeometry, rightRayMaterial);
    rightDrawingRayHelper.visible = false;
    scene.add(rightDrawingRayHelper);
    
    const leftRayGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -5)
    ]);
    const leftRayMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 }); // Red for left
    leftDrawingRayHelper = new THREE.Line(leftRayGeometry, leftRayMaterial);
    leftDrawingRayHelper.visible = false;
    scene.add(leftDrawingRayHelper);

    // Add status text display as HUD overlay in top-left corner
    statusDisplay = new Text();
    statusDisplay.anchorX = 'left';
    statusDisplay.anchorY = 'top';
    statusDisplay.fontSize = 0.015;
    statusDisplay.color = 0xffffff;
    statusDisplay.outlineWidth = 0.001;
    statusDisplay.outlineColor = 0x000000;
    statusDisplay.maxWidth = 0.25;
    
    // Attach to camera so it follows the player's view
    camera.add(statusDisplay);
    
    // Position in top-left corner of view (-X is left, +Y is up, -Z is forward)
    statusDisplay.position.set(-0.08, 0.06, -0.5);
}

// Main frame loop - handles calibration and drawing
async function onFrame(delta, time, {scene, camera, renderer, player, controllers}) {
    const controllerConfigs = [controllers.right, controllers.left];

    // Update status display based on calibration state
    if (!calibrated) {
        if (!aspectRatio) {
            statusDisplay.text = 'Waiting for wall...';
        } else {
            statusDisplay.text = `Joystick: Move ${selectedCorner === 'topLeft' ? 'Top-L' : 'Bot-R'} | B: Switch | A: Save`;
        }
        statusDisplay.sync();
    } else {
        statusDisplay.text = 'Ready | X: Recalibrate';
        statusDisplay.sync();
    }

    // Calibration mode: adjust corners with controllers
    if (!calibrated && aspectRatio) {
        // Update corner indicator - position it as a vertical bar on the rectangle edge
        if (rectYDistance) {
            cornerIndicator.visible = true;
            const activeCorner = selectedCorner === 'topLeft' ? topLeftCorner : bottomRightCorner;
            
            // Position at corner X,Z but centered vertically on the rectangle
            const rectangleCenterY = topLeftCorner[1] - rectYDistance / 2;
            cornerIndicator.position.set(activeCorner[0], rectangleCenterY, activeCorner[2]);
            
            // Scale bar to match rectangle height
            cornerIndicator.scale.y = rectYDistance * 1.1; // 10% taller to ensure it covers the edge
        }
        
        // Only use right controller (index 0) for positioning
        const controller = controllerConfigs[0];
        if (controller && controller.gamepad && controller.raySpace) {
            const { gamepad, raySpace } = controller;
            
            // Update ray helper
            rayHelper.visible = true;
            rayHelper.position.copy(raySpace.position);
            rayHelper.quaternion.copy(raySpace.quaternion);
            
            // Calculate ray direction from controller
            const rayDirection = new THREE.Vector3(0, 0, -1);
            rayDirection.applyQuaternion(raySpace.quaternion);
            rayDirection.normalize();
            
            // Position selected corner along ray at current distance (ALWAYS, every frame)
            const corner = selectedCorner === 'topLeft' ? topLeftCorner : bottomRightCorner;
            corner[0] = raySpace.position.x + rayDirection.x * cornerDistance;
            corner[1] = raySpace.position.y + rayDirection.y * cornerDistance;
            corner[2] = raySpace.position.z + rayDirection.z * cornerDistance;
            
            // Adjust distance along ray with joystick Y axis
            const thumbstickY = gamepad.getAxis(XR_AXES.THUMBSTICK_Y);
            if (Math.abs(thumbstickY) > 0.1) {
                // Move distance (negative thumbstickY means push forward = increase distance)
                cornerDistance += -thumbstickY * 0.02; // 2cm per frame
                cornerDistance = Math.max(0.5, Math.min(cornerDistance, 10)); // Clamp between 0.5m and 10m
            }
            
            // Switch selected corner with B button (button 2)
            if (gamepad.getButtonDown(XR_BUTTONS.BUTTON_2)) {
                selectedCorner = selectedCorner === 'topLeft' ? 'bottomRight' : 'topLeft';
                // Reset distance for new corner
                cornerDistance = 2.0;
            }
            
            // Save calibration with A button (button 1)
            if (gamepad.getButtonDown(XR_BUTTONS.BUTTON_1)) {
                calibrated = true;
                fineTuneMode = false;
                cornerIndicator.visible = false;
                rayHelper.visible = false;
                if (!screenRect && aspectRatio) {
                    addScreenRect(scene);
                }
            }
            
            // Update rectangle in real-time every frame
            if (aspectRatio) {
                const directionX = bottomRightCorner[0] - topLeftCorner[0];
                const directionZ = bottomRightCorner[2] - topLeftCorner[2];
                rectXDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);
                rectYDistance = rectXDistance / aspectRatio;
            }
            
            if (screenRect) scene.remove(screenRect);
            addScreenRect(scene);
        }
        
        return; // Skip normal drawing during calibration
    }

    // Process each controller for normal drawing
    for (let i = 0; i < 2; i++) {
        const controller = controllerConfigs[i];
        if (!controller) continue;
        
        const { gamepad, raySpace, gripSpace, mesh } = controller;
        if (!gamepad || !gripSpace) continue;
        
        if (calibrated) {
            // Restart calibration with X button (button 2 on left controller)
            if (gamepad.getButton(XR_BUTTONS.BUTTON_1) && gamepad.getButton(XR_BUTTONS.BUTTON_2)) {
                calibrated = false;
                fineTuneMode = true;
                selectedCorner = 'topLeft';
                cornerIndicator.visible = true; // Show indicator when recalibrating
            }
            
            // Send controller state to wall for drawing
            sendVRState(i, controller);
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

// Send controller state to wall server using raycast intersection
async function sendVRState(i, controller) {
    if (!calibrated || !screenRect || !wallWidth || !wallHeight) return;
    
    const { gamepad, raySpace, gripSpace } = controller;
    if (!raySpace || !gamepad) return;
    
    // Select the correct ray helper based on controller index
    const rayHelperForController = i === 0 ? rightDrawingRayHelper : leftDrawingRayHelper;
    
    // Create raycaster from controller
    const raycaster = new THREE.Raycaster();
    const rayDirection = new THREE.Vector3(0, 0, -1);
    rayDirection.applyQuaternion(raySpace.quaternion);
    raycaster.set(raySpace.position, rayDirection);
    
    // Check intersection with screen rectangle
    const intersects = raycaster.intersectObject(screenRect);
    
    if (intersects.length > 0) {
        const intersection = intersects[0];
        
        // Show drawing ray when intersecting
        rayHelperForController.visible = true;
        rayHelperForController.position.copy(raySpace.position);
        rayHelperForController.quaternion.copy(raySpace.quaternion);
        
        // Get UV coordinates (0-1 range on the plane)
        const uv = intersection.uv;
        
        // Convert UV to canvas pixel coordinates
        const canvasX = uv.x * wallWidth;
        const canvasY = (1 - uv.y) * wallHeight; // Flip Y
        
        // Validate coordinates before sending
        if (isNaN(canvasX) || isNaN(canvasY)) return;
        
        const triggerState = gamepad.getButton(XR_BUTTONS.TRIGGER);
        console.log(`Sending VR state - Controller: ${i === 0 ? 'right' : 'left'}, Canvas: (${Math.round(canvasX)}, ${Math.round(canvasY)}), Trigger: ${triggerState}`);
        
        // Send complete controller state with all data (for future use)
        cm.sendMessage({
            type: 'VR_CONTROLLER_STATE',
            message: {
                controllerType: i === 0 ? 'right' : 'left',
                canvasX: Math.round(canvasX),
                canvasY: Math.round(canvasY),
                position: {
                    x: gripSpace.position.x,
                    y: gripSpace.position.y,
                    z: gripSpace.position.z
                },
                quaternion: {
                    x: gripSpace.quaternion.x,
                    y: gripSpace.quaternion.y,
                    z: gripSpace.quaternion.z,
                    w: gripSpace.quaternion.w
                },
                topLeftCorner: [...topLeftCorner],
                bottomRightCorner: [...bottomRightCorner],
                rectXDistance: rectXDistance,
                rectYDistance: rectYDistance,
                triggerButtonState: gamepad.getButton(XR_BUTTONS.TRIGGER),
                squeezeButtonState: gamepad.getButton(XR_BUTTONS.SQUEEZE),
                button1State: XR_BUTTONS.BUTTON_1 !== undefined ? gamepad.getButton(XR_BUTTONS.BUTTON_1) : false,
                button2State: XR_BUTTONS.BUTTON_2 !== undefined ? gamepad.getButton(XR_BUTTONS.BUTTON_2) : false,
                button3State: XR_BUTTONS.BUTTON_3 !== undefined ? gamepad.getButton(XR_BUTTONS.BUTTON_3) : false,
                button4State: XR_BUTTONS.BUTTON_4 !== undefined ? gamepad.getButton(XR_BUTTONS.BUTTON_4) : false,
                thumbstickX: XR_AXES.THUMBSTICK_X !== undefined ? gamepad.getAxis(XR_AXES.THUMBSTICK_X) : 0,
                thumbstickY: XR_AXES.THUMBSTICK_Y !== undefined ? gamepad.getAxis(XR_AXES.THUMBSTICK_Y) : 0
            }
        });
    } else {
        // Hide ray when not intersecting
        rayHelperForController.visible = false;
    }
}

// Receive wall dimensions and calculate aspect ratio
function handleCalibration(message) {
    if (calibrated) return;
    wallWidth = message.wallWidth;
    wallHeight = message.wallHeight;
    aspectRatio = wallWidth / wallHeight;
    
    // Initialize rectangle dimensions with default corners
    if (sceneVar && !screenRect) {
        const directionX = bottomRightCorner[0] - topLeftCorner[0];
        const directionZ = bottomRightCorner[2] - topLeftCorner[2];
        rectXDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);
        rectYDistance = rectXDistance / aspectRatio;
        addScreenRect(sceneVar);
    }
}

// Reset calibration when wall disconnects
function resetCalibration(message) {
    calibrated = false;
    fineTuneMode = true;
    selectedCorner = 'topLeft';
    if (screenRect) {
        sceneVar.remove(screenRect);
        screenRect = null;
    }
    // Reset to default positions
    topLeftCorner = [-0.5, 1.6, -2.0];
    bottomRightCorner = [1.0, 0.8, -2.0];
    rectXDistance = null;
    rectYDistance = null;
    aspectRatio = null;
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