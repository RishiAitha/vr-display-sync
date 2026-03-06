import * as THREE from 'three';
import { GamepadWrapper } from 'gamepad-wrapper';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// Initialize WebXR scene with camera, renderer, and controllers
export async function init(setupScene = () => {}, onFrame = () => {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    const controls = new OrbitControls(camera, container);
    controls.target.set(0, 1.6, 0);
    controls.update();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    const player = new THREE.Group();
    scene.add(player);
    player.add(camera);

    const controllers = { left: null, right: null };

    for (let i = 0; i < 2; i++) {
        const raySpace = renderer.xr.getController(i);
        const gripSpace = renderer.xr.getControllerGrip(i);
        player.add(raySpace, gripSpace);
        raySpace.visible = false;
        gripSpace.visible = false;
        gripSpace.addEventListener('connected', (e) => {
            raySpace.visible = true;
            gripSpace.visible = true;
            const handedness = e.data.handedness;
            const rawGamepad = e && e.data ? e.data.gamepad : null;
            controllers[handedness] = {
                raySpace,
                gripSpace,
                gamepad: rawGamepad ? new GamepadWrapper(rawGamepad) : null,
            };
        });
        gripSpace.addEventListener('disconnected', (e) => {
            raySpace.visible = false;
            gripSpace.visible = false;
            const handedness = e && e.data ? e.data.handedness : null;
            if (handedness === 'left' || handedness === 'right') {
                controllers[handedness] = null;
            } else {
                if (controllers.left && controllers.left.gripSpace === gripSpace) controllers.left = null;
                if (controllers.right && controllers.right.gripSpace === gripSpace) controllers.right = null;
            }
        });
    }

    function onWindowResize() {
        if (!renderer.xr.isPresenting) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }
    window.addEventListener('resize', onWindowResize);

    const globals = { scene, camera, renderer, player, controllers };
    setupScene(globals);

    const clock = new THREE.Clock();
    function animate(_t, frame) {
        const delta = clock.getDelta();
        const time = clock.getElapsedTime();
        Object.values(controllers).forEach((controller) => {
            if (controller && controller.gamepad) {
                try {
                    controller.gamepad.update();
                } catch (e) {
                    console.warn('Controller gamepad update failed; disabling gamepad for this controller.', e);
                    controller.gamepad = null;
                }
            }
        });
        try {
            onFrame(delta, time, globals, frame);
        } catch (e) {
            console.error('XR frame error (onFrame)', e);
        }
        try {
            renderer.render(scene, camera);
        } catch (e) {
            console.error('XR frame error (renderer.render)', e);
        }
    }
    renderer.setAnimationLoop(animate);

    const arButton = ARButton.createButton(renderer, { requiredFeatures: ['local'], optionalFeatures: ['hand-tracking'] });
    document.body.appendChild(arButton);
}