import * as THREE from 'three';
import { init } from './init.js';
import * as cm from './clientManager.js';
import { XR_BUTTONS, XR_AXES } from 'gamepad-wrapper';
import { Text } from 'troika-three-text';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as gameAPI from './gameAPI.js';
import game from './game.js';
gameAPI.registerGame(game);

// Redirect to desktop if XR not supported
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (!supported) window.location.href = '/desktop';
    });
} else {
    window.location.href = '/desktop';
}

// ---------- Scene & state ----------
let floor;
let screenRect;
let rayHelper;
let statusDisplay;
let frontLabel = null;
let backLabel = null;

const EYE_HEIGHT = 1.6;

// Calibration / rect state
let screenWidth = null;
let screenHeight = null;
let aspectRatio = null;
let topLeftCorner = [-0.5, 1.6, -2.0];
let bottomRightCorner = [1.0, 0.8, -2.0];
let rectXDistance = null;
let rectYDistance = null;
let calibrated = false;
let fineTuneMode = true;
let selectedCorner = 'topLeft';
let cornerDistance = 2.0;
let gameStartedVR = false;

// Latest per-frame screen intersection state (populated each frame)
let latestScreenState = { right: { onScreen: false }, left: { onScreen: false } };
// Latest screen metadata snapshot
let latestScreenMeta = { screenWidth: null, screenHeight: null, topLeftCorner: [...topLeftCorner], bottomRightCorner: [...bottomRightCorner], rectXDistance: null, rectYDistance: null };

// Scene refs
let sceneVar = null;
let camVar = null;

// Widget system
let loader = null;
let widgetGroup = null;
let confirmBall = null;
let widgetTemplates = { transformArrow: null, rotateArrow: null, scaleCube: null };
let curvedScreenTemplate = null;
let cachedMeshDimensions = null; // Cache original mesh dimensions to avoid recalculating bbox
let widgetsSpawned = false;
let grabbedWidget = null;
let grabState = null;
let hoveredWidget = null;

// ---------- Utilities ----------
function applyColorToMesh(object, hexColor) {
    object.traverse((node) => {
        if (node.isMesh) {
            if (!node.userData.originalMaterial) node.userData.originalMaterial = node.material;
            node.material = new THREE.MeshBasicMaterial({ color: hexColor });
            node.material.needsUpdate = true;
        }
    });
    if (object.userData.originalColor === undefined) object.userData.originalColor = hexColor;
}

function restoreColorFromUserData(object) {
    if (object.userData && object.userData.originalColor !== undefined) {
        applyColorToMesh(object, object.userData.originalColor);
        return;
    }
    object.traverse((node) => {
        if (node.isMesh && node.userData && node.userData.originalMaterial) {
            node.material = node.userData.originalMaterial;
            node.material.needsUpdate = true;
        }
    });
}

function rotatePointAroundY(point, center, angle) {
    const p = point.clone().sub(center);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const x = p.x * cos - p.z * sin;
    const z = p.x * sin + p.z * cos;
    return new THREE.Vector3(x, p.y, z).add(center);
}

// ---------- Widgets ----------
function loadWidgetTemplates() {
    if (!loader) loader = new GLTFLoader();
    const basePath = '/assets/';
    loader.load(basePath + 'transform_arrow.glb', (gltf) => { widgetTemplates.transformArrow = gltf.scene.clone(); }, undefined, () => {});
    loader.load(basePath + 'rotate_arrow.glb', (gltf) => { widgetTemplates.rotateArrow = gltf.scene.clone(); }, undefined, () => {});
    loader.load(basePath + 'scale_cube.glb', (gltf) => { widgetTemplates.scaleCube = gltf.scene.clone(); }, undefined, () => {});
    loader.load(basePath + 'led_wall.glb', (gltf) => { curvedScreenTemplate = gltf.scene.clone(); }, undefined, (error) => { console.error('Failed to load led_wall.glb:', error); });
}

function highlightWidget(widget) {
    if (!widget) return;
    widget.traverse((node) => {
        if (node.isMesh && node.material) {
            if (node.userData._hoverPrevColor === undefined && node.material.color) node.userData._hoverPrevColor = node.material.color.getHex();
            if (node.material.color) node.material.color.setHex(0xffffff);
        }
    });
}
function clearHighlight(widget) {
    if (!widget) return;
    widget.traverse((node) => {
        if (node.isMesh && node.material && node.userData && node.userData._hoverPrevColor !== undefined) {
            node.material.color.setHex(node.userData._hoverPrevColor);
            delete node.userData._hoverPrevColor;
        }
    });
}

function spawnWidgets(scene) {
    if (!widgetGroup || widgetsSpawned) return;
    widgetsSpawned = true;
    const center = new THREE.Vector3(0, -0.3, -0.3);
    while (widgetGroup.children.length) widgetGroup.remove(widgetGroup.children[0]);

    const baseScale = 0.18 * 0.7;

    const arrowAxes = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)];
    const translateColors = [0xff0000, 0x00ff00, 0x0000ff];
    for (let i=0;i<3;i++) {
        let tpl = widgetTemplates.transformArrow ? widgetTemplates.transformArrow.clone() : null;
        let mesh = tpl || new THREE.Mesh(new THREE.ConeGeometry(0.04,0.15,8), new THREE.MeshBasicMaterial({color:translateColors[i]}));
        mesh.scale.setScalar(baseScale);
        mesh.userData.type = 'translate';
        mesh.userData.axis = arrowAxes[i].clone();
        mesh.position.copy(center);
        if (i === 0) mesh.rotation.z = -Math.PI / 2;
        if (i === 2) mesh.rotation.x = Math.PI / 2;
        applyColorToMesh(mesh, translateColors[i]);
        widgetGroup.add(mesh);
    }

    let rotTpl = widgetTemplates.rotateArrow ? widgetTemplates.rotateArrow.clone() : null;
    let rotMesh = rotTpl || new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 32), new THREE.MeshBasicMaterial({color:0x00aaff}));
    rotMesh.scale.setScalar(baseScale * 0.9);
    rotMesh.userData.type = 'rotate';
    rotMesh.position.copy(center);
    applyColorToMesh(rotMesh, 0xffff00);
    widgetGroup.add(rotMesh);

    const tlPos = new THREE.Vector3(-0.3, 0, -0.3);
    const brPos = new THREE.Vector3(0.3, -0.6, -0.3);
    const tlTpl = widgetTemplates.scaleCube ? widgetTemplates.scaleCube.clone() : null;
    const brTpl = widgetTemplates.scaleCube ? widgetTemplates.scaleCube.clone() : null;
    const tlMesh = tlTpl || new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,0.05), new THREE.MeshBasicMaterial({color:0xff69b4}));
    const brMesh = brTpl || new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,0.05), new THREE.MeshBasicMaterial({color:0xffa500}));
    tlMesh.scale.setScalar(baseScale * 0.9);
    brMesh.scale.setScalar(baseScale * 0.9);
    tlMesh.userData.type = 'scale'; tlMesh.userData.corner = 'topLeft';
    brMesh.userData.type = 'scale'; brMesh.userData.corner = 'bottomRight';
    tlMesh.position.copy(tlPos);
    brMesh.position.copy(brPos);
    applyColorToMesh(tlMesh, 0xff69b4);
    applyColorToMesh(brMesh, 0xffa500);
    widgetGroup.add(tlMesh, brMesh);

    // Add purple confirmation ball at center
    const ballGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const ballMaterial = new THREE.MeshBasicMaterial({ color: 0x9b59d6, emissive: 0x9b59d6, emissiveIntensity: 0.5 });
    confirmBall = new THREE.Mesh(ballGeometry, ballMaterial);
    confirmBall.scale.setScalar(baseScale * 0.9);
    confirmBall.userData.type = 'confirm';
    confirmBall.position.copy(center);
    widgetGroup.add(confirmBall);

    widgetGroup.visible = true;
}

function updateWidgetPositions() {
    if (!widgetGroup || !screenRect) return;
    
    // Get the actual bounding box of the positioned mesh in world space
    screenRect.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(screenRect);
    
    // Actual corner positions from the mesh bounds
    const tl = new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z); // top-left-front
    const br = new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z); // bottom-right-front
    const center = bbox.getCenter(new THREE.Vector3());
    
    widgetGroup.children.forEach((child) => {
        if (child.userData && child.userData.type === 'scale') {
            const cornerName = child.userData.corner;
            const cornerPos = cornerName === 'topLeft' ? tl.clone() : br.clone();
            
            // Manual x-axis offset to move widgets outward to actual corners
            if (cornerName === 'topLeft') {
                cornerPos.x -= 0.05; // Move left
            } else {
                cornerPos.x += 0.05; // Move right
            }
            
            // Move slightly toward center for visibility
            const inward = center.clone().sub(cornerPos).normalize().multiplyScalar(0.05);
            const worldPos = cornerPos.clone().add(inward);
            
            if (child.parent) {
                const localPos = worldPos.clone();
                child.parent.worldToLocal(localPos);
                child.position.copy(localPos);
            } else {
                child.position.copy(worldPos);
            }
        }
    });
}

// ---------- Scene setup ----------
function setupScene({ scene, camera, renderer, player, controllers }) {
    sceneVar = scene;
    camVar = camera;
    loader = new GLTFLoader();
    widgetGroup = new THREE.Group();
    widgetGroup.visible = false;
    scene.add(widgetGroup);
    loadWidgetTemplates();

    const floorGeometry = new THREE.PlaneGeometry(6, 6);
    const floorMaterial = new THREE.MeshBasicMaterial({color: 'black', transparent: true, opacity: 0.5 });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotateX(-Math.PI / 2);
    floor.position.y = -EYE_HEIGHT;
    scene.add(floor);

    const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-3)]);
    rayHelper = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    rayHelper.visible = false;
    scene.add(rayHelper);

    statusDisplay = new Text();
    statusDisplay.anchorX = 'left';
    statusDisplay.anchorY = 'top';
    statusDisplay.fontSize = 0.015;
    statusDisplay.color = 0xffffff;
    statusDisplay.outlineWidth = 0.001;
    statusDisplay.outlineColor = 0x000000;
    statusDisplay.maxWidth = 0.25;
    camera.add(statusDisplay);
    statusDisplay.position.set(-0.08, 0.06, -0.5);
}

// ---------- Frame loop ----------
async function onFrame(delta, time, {scene, camera, renderer, player, controllers}) {
    // Compute per-controller screen intersection state and screen metadata (store to shared latest values)
    latestScreenMeta = {
        screenWidth,
        screenHeight,
        topLeftCorner: [...topLeftCorner],
        bottomRightCorner: [...bottomRightCorner],
        rectXDistance,
        rectYDistance
    };
    // reset defaults
    latestScreenState.right = { onScreen: false };
    latestScreenState.left = { onScreen: false };
    if (calibrated && screenRect && screenWidth && screenHeight) {
        ['right', 'left'].forEach((side) => {
            const controller = controllers && controllers[side];
            if (!controller) return;
            const { raySpace } = controller;
            if (!raySpace) return;
            const rayDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(raySpace.quaternion);
            const raycaster = new THREE.Raycaster();
            raycaster.set(raySpace.position, rayDirection);
            // Intersect recursively through Group children (for loaded .glb)
            const intersects = raycaster.intersectObject(screenRect, true);
            if (intersects.length > 0) {
                const uv = intersects[0].uv;
                if (!uv) {
                    console.warn('No UV data on curved mesh intersection');
                    latestScreenState[side] = { onScreen: false };
                    return;
                }
                const canvasX = uv.x * screenWidth;
                const canvasY = (1 - uv.y) * screenHeight;
                if (!isNaN(canvasX) && !isNaN(canvasY)) {
                    latestScreenState[side] = { onScreen: true, canvasX: Math.round(canvasX), canvasY: Math.round(canvasY), uv, hitPoint: intersects[0].point };
                } else {
                    latestScreenState[side] = { onScreen: false };
                }
            } else {
                latestScreenState[side] = { onScreen: false };
            }
        });
    }

    // Drive game updates when started, provide screenState + screenMeta in the context
    if (gameStartedVR) {
        try {
            gameAPI.updateVR(delta, time, { scene, camera, renderer, player, controllers, sendGameMessage: gameAPI.sendGameMessage, screenState: latestScreenState, screenMeta: latestScreenMeta, screenRect });
        } catch (e) {
            console.error('game updateVR error', e);
        }
    }
    const controllerConfigs = [controllers.right, controllers.left];

    if (!calibrated) {
        statusDisplay.text = !aspectRatio ? 'Waiting for screen...' : 'Manual calibration: Use right controller. Trigger to grab; aim at purple ball & trigger to Save';
        statusDisplay.sync();
    } else {
        statusDisplay.text = 'Ready | Aim at purple ball & trigger to Recalibrate';
        statusDisplay.sync();
    }

    // Calibration flow (manual)
    if (!calibrated && aspectRatio) {
        const controller = controllerConfigs[0];
        if (controller && controller.gamepad && controller.raySpace) {
            const { gamepad, raySpace } = controller;
            rayHelper.visible = true;
            rayHelper.position.copy(raySpace.position);
            rayHelper.quaternion.copy(raySpace.quaternion);

            const rayDirection = new THREE.Vector3(0,0,-1).applyQuaternion(raySpace.quaternion).normalize();

            const raycasterWidgets = new THREE.Raycaster();
            raycasterWidgets.set(raySpace.position, rayDirection);
            let widgetIntersects = [];
            if (widgetGroup && widgetGroup.visible) widgetIntersects = raycasterWidgets.intersectObjects(widgetGroup.children, true);

            let hoverTarget = null;
            if (widgetIntersects.length > 0) {
                let hit = widgetIntersects[0].object;
                while (hit.parent && hit.parent !== widgetGroup) hit = hit.parent;
                hoverTarget = hit;
            }

            if (hoverTarget !== hoveredWidget) {
                if (hoveredWidget) clearHighlight(hoveredWidget);
                hoveredWidget = hoverTarget;
                if (hoveredWidget) highlightWidget(hoveredWidget);
            }

            // Start grab
            if (gamepad.getButtonDown && gamepad.getButtonDown(XR_BUTTONS.TRIGGER) && hoveredWidget && !grabbedWidget) {
                // Skip if we're clicking the confirm ball
                if (hoveredWidget.userData && hoveredWidget.userData.type === 'confirm') {
                    // Handle confirmation ball click - commit calibration
                    cm.sendMessage({
                        type: 'CALIBRATION_COMMIT',
                        message: {
                            topLeftCorner: [...topLeftCorner],
                            bottomRightCorner: [...bottomRightCorner],
                            rectXDistance,
                            rectYDistance
                        }
                    });
                    calibrated = true;
                    // Start the active game once calibration is committed
                    if (!gameStartedVR) {
                        gameStartedVR = true;
                        try { await gameAPI.startVR({ scene, camera, renderer, player, controllers, sendGameMessage: gameAPI.sendGameMessage }); } catch (e) { console.error('game startVR error', e); }
                    }
                    fineTuneMode = false;
                    rayHelper.visible = false;
                    widgetsSpawned = false;
                    // Keep only the confirm ball visible
                    if (widgetGroup) {
                        widgetGroup.children.forEach((child) => {
                            if (child.userData && child.userData.type !== 'confirm') {
                                child.visible = false;
                            }
                        });
                    }
                    if (!screenRect && aspectRatio) addScreenRect(scene);
                    if (screenRect) screenRect.visible = true;
                    if (frontLabel) { if (frontLabel.parent) frontLabel.parent.remove(frontLabel); frontLabel = null; }
                    if (backLabel) { if (backLabel.parent) backLabel.parent.remove(backLabel); backLabel = null; }
                    return;
                }
                grabbedWidget = hoveredWidget;
                const qWorld = new THREE.Quaternion();
                grabbedWidget.getWorldQuaternion(qWorld);
                const startControllerPos = raySpace.position.clone();
                const startWidgetWorldPos = (() => { const p = new THREE.Vector3(); grabbedWidget.getWorldPosition(p); return p; })();
                grabState = {
                    widget: grabbedWidget,
                    type: grabbedWidget.userData.type || 'unknown',
                    startControllerPos,
                    startControllerQuat: raySpace.quaternion.clone(),
                    startTopLeft: [...topLeftCorner],
                    startBottomRight: [...bottomRightCorner],
                    startWidgetWorldPos
                };
                if (grabbedWidget.userData && grabbedWidget.userData.axis) {
                    grabState.axisWorld = grabbedWidget.userData.axis.clone().normalize();
                    grabState.startProjected = startControllerPos.clone().sub(startWidgetWorldPos).dot(grabState.axisWorld) || 0;
                } else {
                    grabState.axisWorld = null;
                    grabState.startProjected = 0;
                }
                if (grabState.type === 'rotate') {
                    const startVec = startControllerPos.clone().sub(startWidgetWorldPos);
                    grabState.startRotateAngle = Math.atan2(startVec.z, startVec.x);
                    grabState.startWidgetYRotation = grabbedWidget.rotation ? grabbedWidget.rotation.y || 0 : 0;
                }
                applyColorToMesh(grabbedWidget, 0xffffff);
                if (hoveredWidget) { clearHighlight(hoveredWidget); hoveredWidget = null; }
            }

            // Update while grabbing
            if (grabbedWidget && gamepad.getButton && gamepad.getButton(XR_BUTTONS.TRIGGER)) {
                const type = grabbedWidget.userData.type;
                if (type === 'translate') {
                    const axisWorld = grabState.axisWorld ? grabState.axisWorld.clone() : (grabbedWidget.userData.axis ? grabbedWidget.userData.axis.clone().normalize() : new THREE.Vector3(1,0,0));
                    const current = raySpace.position.clone();
                    const rel = current.clone().sub(grabState.startWidgetWorldPos);
                    const amount = rel.dot(axisWorld) - (grabState.startProjected || 0);
                    const translateVec = axisWorld.clone().multiplyScalar(amount);
                    topLeftCorner[0] = grabState.startTopLeft[0] + translateVec.x;
                    topLeftCorner[1] = grabState.startTopLeft[1] + translateVec.y;
                    topLeftCorner[2] = grabState.startTopLeft[2] + translateVec.z;
                    bottomRightCorner[0] = grabState.startBottomRight[0] + translateVec.x;
                    bottomRightCorner[1] = grabState.startBottomRight[1] + translateVec.y;
                    bottomRightCorner[2] = grabState.startBottomRight[2] + translateVec.z;
                    if (grabState.startWidgetWorldPos) {
                        const newWorldPos = grabState.startWidgetWorldPos.clone().add(translateVec);
                        if (grabbedWidget.parent) {
                            const localPos = newWorldPos.clone();
                            grabbedWidget.parent.worldToLocal(localPos);
                            grabbedWidget.position.copy(localPos);
                        } else {
                            grabbedWidget.position.copy(newWorldPos);
                        }
                    }
                } else if (type === 'rotate') {
                    const widgetCenter = grabState.startWidgetWorldPos.clone();
                    const startAngle = grabState.startRotateAngle !== undefined ? grabState.startRotateAngle : Math.atan2(grabState.startControllerPos.z - widgetCenter.z, grabState.startControllerPos.x - widgetCenter.x);
                    const currAngle = Math.atan2(raySpace.position.z - widgetCenter.z, raySpace.position.x - widgetCenter.x);
                    const deltaAngle = currAngle - startAngle;
                    const center = new THREE.Vector3(
                        grabState.startTopLeft[0] + (grabState.startBottomRight[0] - grabState.startTopLeft[0]) / 2,
                        grabState.startTopLeft[1] - (rectYDistance / 2),
                        grabState.startTopLeft[2] + (grabState.startBottomRight[2] - grabState.startTopLeft[2]) / 2
                    );
                    const tl = new THREE.Vector3(grabState.startTopLeft[0], grabState.startTopLeft[1], grabState.startTopLeft[2]);
                    const br = new THREE.Vector3(grabState.startBottomRight[0], grabState.startBottomRight[1], grabState.startBottomRight[2]);
                    const newTL = rotatePointAroundY(tl, center, deltaAngle);
                    const newBR = rotatePointAroundY(br, center, deltaAngle);
                    topLeftCorner = [newTL.x, newTL.y, newTL.z];
                    bottomRightCorner = [newBR.x, newBR.y, newBR.z];
                    if (grabState.startWidgetYRotation !== undefined) {
                        const visualFactor = 0.35;
                        grabbedWidget.rotation.y = grabState.startWidgetYRotation - deltaAngle * visualFactor;
                    }
                } else if (type === 'scale') {
                    const cornerName = grabbedWidget.userData.corner;
                    const fixed = cornerName === 'topLeft' ? grabState.startBottomRight : grabState.startTopLeft;
                    const movingStart = cornerName === 'topLeft' ? grabState.startTopLeft : grabState.startBottomRight;
                    const fixedV = new THREE.Vector3(fixed[0], fixed[1], fixed[2]);
                    const startV = new THREE.Vector3(movingStart[0], movingStart[1], movingStart[2]);
                    const dir = startV.clone().sub(fixedV);
                    const dirNorm = dir.clone().normalize();
                    const curr = raySpace.position;
                    const delta = curr.clone().sub(grabState.startControllerPos);
                    const projected = delta.dot(dirNorm);
                    const k = 1.0;
                    const scaleFactor = Math.exp(k * (projected / Math.max(0.001, dir.length())));
                    const newVec = dir.clone().multiplyScalar(scaleFactor);
                    const newMoving = fixedV.clone().add(newVec);
                    if (cornerName === 'topLeft') {
                        topLeftCorner = [newMoving.x, newMoving.y, newMoving.z];
                    } else {
                        bottomRightCorner = [newMoving.x, newMoving.y, newMoving.z];
                    }
                }
                // Update measures & visuals
                const dx = bottomRightCorner[0] - topLeftCorner[0];
                const dz = bottomRightCorner[2] - topLeftCorner[2];
                rectXDistance = Math.sqrt(dx * dx + dz * dz);
                rectYDistance = rectXDistance / aspectRatio;
                addScreenRect(scene);
            }

            // Release grab
            if (grabbedWidget && (!gamepad.getButton || !gamepad.getButton(XR_BUTTONS.TRIGGER))) {
                if (grabbedWidget) restoreColorFromUserData(grabbedWidget);
                grabbedWidget = null;
                grabState = null;
                if (!calibrated) {
                    widgetsSpawned = false;
                    if (widgetGroup) widgetGroup.visible = true;
                    spawnWidgets(scene);
                }
            }

            // Adjust distance with thumbstick
            const thumbstickY = gamepad.getAxis(XR_AXES.THUMBSTICK_Y);
            if (Math.abs(thumbstickY) > 0.1) {
                cornerDistance += -thumbstickY * 0.02;
                cornerDistance = Math.max(0.5, Math.min(cornerDistance, 10));
            }

            // Switch corner with B
            if (gamepad.getButtonDown(XR_BUTTONS.BUTTON_2)) {
                selectedCorner = selectedCorner === 'topLeft' ? 'bottomRight' : 'topLeft';
                cornerDistance = 2.0;
            }

            // Keep live rectangle updated
            if (aspectRatio) {
                const directionX = bottomRightCorner[0] - topLeftCorner[0];
                const directionZ = bottomRightCorner[2] - topLeftCorner[2];
                rectXDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);
                rectYDistance = rectXDistance / aspectRatio;
            }
            addScreenRect(scene);
        }
        return;
    }

    // If not calibrated, nothing else to do
    if (!calibrated) return;

    // Allow right controller trigger on confirm ball to restart calibration
    try {
        const rightController = controllerConfigs[0];
        if (calibrated && rightController && rightController.gamepad && rightController.raySpace) {
            const { gamepad, raySpace } = rightController;
            
            // Check if aiming at confirm ball
            const rayDirection = new THREE.Vector3(0,0,-1).applyQuaternion(raySpace.quaternion).normalize();
            const raycaster = new THREE.Raycaster();
            raycaster.set(raySpace.position, rayDirection);
            let ballIntersects = [];
            if (confirmBall && confirmBall.visible) {
                ballIntersects = raycaster.intersectObject(confirmBall, true);
            }
            
            // Highlight ball when hovering
            if (ballIntersects.length > 0) {
                highlightWidget(confirmBall);
                
                // Trigger on ball restarts calibration
                if (gamepad.getButtonDown && gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
                    calibrated = false;
                    fineTuneMode = true;
                    selectedCorner = 'topLeft';
                    cornerDistance = 2.0;
                    widgetsSpawned = false;
                    if (widgetGroup) {
                        widgetGroup.visible = true;
                        // Make all widgets visible again
                        widgetGroup.children.forEach((child) => {
                            child.visible = true;
                        });
                    }
                    if (sceneVar) spawnWidgets(sceneVar);
                    rayHelper.visible = true;
                    if (screenRect && screenRect.parent) { screenRect.parent.remove(screenRect); screenRect = null; }
                }
            } else {
                // Clear highlight when not hovering
                if (confirmBall) clearHighlight(confirmBall);
            }
        }
    } catch (e) {
        console.warn('restart-via-ball error', e);
    }
}

// ---------- Screen rect & labels ----------
function addScreenRect(scene) {
    const directionX = bottomRightCorner[0] - topLeftCorner[0];
    const directionZ = bottomRightCorner[2] - topLeftCorner[2];
    const angle = Math.atan2(directionZ, directionX);
    const cornerDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);
    rectXDistance = cornerDistance;
    rectYDistance = cornerDistance / aspectRatio;

    if (!screenRect) {
        if (curvedScreenTemplate) {
            screenRect = curvedScreenTemplate.clone();
            // Apply transparent material to all meshes in the loaded model
            screenRect.traverse((node) => {
                if (node.isMesh) {
                    node.material = new THREE.MeshBasicMaterial({
                        color: 'white',
                        transparent: true,
                        opacity: 0.2,
                        side: THREE.DoubleSide
                    });
                    node.material.needsUpdate = true;
                }
            });
        } else {
            // Fallback to plane if mesh not loaded yet
            console.warn('Curved screen template not loaded, using fallback plane');
            const unitGeometry = new THREE.PlaneGeometry(1, 1);
            const screenRectMaterial = new THREE.MeshBasicMaterial({
                color: 'white',
                transparent: true,
                opacity: 0.2,
                side: THREE.DoubleSide
            });
            screenRect = new THREE.Mesh(unitGeometry, screenRectMaterial);
        }
        screenRect.name = 'screenRect';
        screenRect.frustumCulled = false;
        scene.add(screenRect);
        
        // Calculate and cache bounding box dimensions once when mesh is first created
        screenRect.updateMatrixWorld(true); // Ensure matrix is updated before bbox calculation
        const bbox = new THREE.Box3().setFromObject(screenRect);
        cachedMeshDimensions = {
            width: bbox.max.x - bbox.min.x,
            height: bbox.max.y - bbox.min.y,
            depth: bbox.max.z - bbox.min.z
        };
    }

    // Use cached dimensions if available, otherwise fall back to calculating (for plane fallback)
    const meshWidth = cachedMeshDimensions ? cachedMeshDimensions.width : 1;
    const meshHeight = cachedMeshDimensions ? cachedMeshDimensions.height : 1;

    // Calculate scale to match calibrated dimensions
    const scaleX = rectXDistance / meshWidth;
    const scaleY = rectYDistance / meshHeight;
    const scaleZ = scaleX; // Maintain curve depth proportional to width

    screenRect.scale.set(scaleX, scaleY, scaleZ);
    const centerPos = new THREE.Vector3(
        topLeftCorner[0] + (rectXDistance / 2) * Math.cos(angle),
        topLeftCorner[1] - (rectYDistance / 2),
        topLeftCorner[2] + (rectXDistance / 2) * Math.sin(angle)
    );
    screenRect.position.copy(centerPos);
    screenRect.rotation.set(0, -angle + Math.PI, 0); // Add PI to flip mesh 180 degrees

    // Labels
    if (!frontLabel) {
        frontLabel = new Text();
        frontLabel.anchorX = 'center';
        frontLabel.anchorY = 'top';
        frontLabel.fontSize = 0.035;
        frontLabel.color = 0xffffff;
        frontLabel.outlineWidth = 0.001;
        frontLabel.outlineColor = 0x000000;
        frontLabel.frustumCulled = false;
        scene.add(frontLabel);
    }
    if (!backLabel) {
        backLabel = new Text();
        backLabel.anchorX = 'center';
        backLabel.anchorY = 'top';
        backLabel.fontSize = 0.035;
        backLabel.color = 0xffffff;
        backLabel.outlineWidth = 0.001;
        backLabel.outlineColor = 0x000000;
        backLabel.frustumCulled = false;
        scene.add(backLabel);
    }

    const localY = rectYDistance / 2 - 0.03;
    const insetZ = 0.01;
    frontLabel.text = 'Front';
    backLabel.text = 'Back';

    if (screenRect) screenRect.updateMatrixWorld(true);

    const frontLocal = new THREE.Vector3(0, localY, insetZ);
    const backLocal = new THREE.Vector3(0, localY, -insetZ);
    const frontWorld = frontLocal.clone();
    const backWorld = backLocal.clone();
    if (screenRect) {
        screenRect.localToWorld(frontWorld);
        screenRect.localToWorld(backWorld);
        frontLabel.position.copy(frontWorld);
        backLabel.position.copy(backWorld);
    }

    if (screenRect) {
        const planeQuat = screenRect.quaternion.clone();
        frontLabel.quaternion.copy(planeQuat);
        const yFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
        const backQuat = planeQuat.clone().multiply(yFlip);
        backLabel.quaternion.copy(backQuat);
    }
    frontLabel.sync();
    backLabel.sync();

    [frontLabel, backLabel].forEach((lbl) => {
        if (!lbl) return;
        lbl.renderOrder = 9999;
        lbl.frustumCulled = false;
        if (lbl.material) {
            lbl.material.depthTest = false;
            lbl.material.depthWrite = false;
            lbl.material.transparent = true;
        }
    });

    setTimeout(() => {
        // If calibration completed in the meantime, remove any lingering labels
        // and avoid re-showing them from this timeout callback.
        if (calibrated) {
            [frontLabel, backLabel].forEach((lbl) => {
                try {
                    if (!lbl) return;
                    if (lbl.parent) lbl.parent.remove(lbl);
                } catch (e) {}
            });
            frontLabel = null;
            backLabel = null;
            return;
        }
        [frontLabel, backLabel].forEach((lbl) => {
            if (!lbl) return;
            if (lbl.material) {
                lbl.material.depthTest = false;
                lbl.material.depthWrite = false;
                lbl.material.transparent = true;
            }
            lbl.visible = true;
            lbl.frustumCulled = false;
        });
    }, 100);

    updateWidgetPositions();
}

// ---------- Calibration messages ----------
function handleCalibration(message) {
    if (calibrated) return;
    screenWidth = message.screenWidth;
    screenHeight = message.screenHeight;
    aspectRatio = screenWidth / screenHeight;
    if (sceneVar && !screenRect) {
        if (!curvedScreenTemplate) {
            console.warn('Curved screen template not loaded yet, retrying in 500ms...');
            setTimeout(() => handleCalibration(message), 500);
            return;
        }
        const center = new THREE.Vector3(0, -0.3, -0.6);
        rectXDistance = 1.0;
        rectYDistance = rectXDistance / aspectRatio;
        topLeftCorner = [center.x - rectXDistance / 2, center.y + rectYDistance / 2, center.z];
        bottomRightCorner = [center.x + rectXDistance / 2, center.y - rectYDistance / 2, center.z];
        addScreenRect(sceneVar);
        spawnWidgets(sceneVar);
    }
}

function resetCalibration() {
    calibrated = false;
    fineTuneMode = true;
    selectedCorner = 'topLeft';
    if (screenRect) { sceneVar.remove(screenRect); screenRect = null; }
    if (frontLabel) { if (frontLabel.parent) frontLabel.parent.remove(frontLabel); frontLabel = null; }
    if (backLabel) { if (backLabel.parent) backLabel.parent.remove(backLabel); backLabel = null; }
    cachedMeshDimensions = null; // Reset cached dimensions
    topLeftCorner = [-0.5, 1.6, -2.0];
    bottomRightCorner = [1.0, 0.8, -2.0];
    rectXDistance = null;
    rectYDistance = null;
    aspectRatio = null;
}

// ---------- Registration ----------
cm.registerToServer('VR').then(updateStatus).catch((e) => { console.error('Failed to register:', e); updateStatus(); });
function updateStatus() {
    const state = cm.getConnectionState();
    if (statusDisplay) {
        statusDisplay.text = `Connection Status: ${state.state}`;
        statusDisplay.sync();
    }
}

cm.handleEvent('CLOSE', updateStatus);
cm.handleEvent('SCREEN_CALIBRATION', handleCalibration);
cm.handleEvent('SCREEN_DISCONNECTED', resetCalibration);

// Initialize XR scene
init(setupScene, onFrame);