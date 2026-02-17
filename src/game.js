import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

export default {
    // Instance variables here

    // VR handling
    // Use context.sendGameMessage(payload) to emit game events.

    // VR-side initialization hook.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage }
    async startVR(context) {
        this.latestPoint = {};
        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), sphereMaterial);
        context.scene.add(this.marker);

        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
        const points = [ new THREE.Vector3(), new THREE.Vector3(0,0,-0.1) ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        this.pointer = new THREE.Line(geometry, lineMaterial);
        context.scene.add(this.pointer);
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage,
    //            screenState, screenMeta, screenRect }
    // - `screenState`: object with `right` and `left` entries, each `{ onScreen, canvasX, canvasY, uv, hitPoint }` (per-frame intersection)
    //      - if onScreen is false, nothing else is sent; canvasX and canvasY are canvas coords, hitPoint is WebXR coords, uv is 2D coords on rect.
    // - `screenMeta`: metadata snapshot `{ screenWidth, screenHeight, topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance }`
    // - `screenRect`: the THREE.Mesh used to represent the screen rect (optional)
    updateVR(delta, time, context) {
        if (this.latestPoint) {
            const point = this.latestPoint;
            const uvx = point.canvasX / point.screenWidth;
            const uvy = point.canvasY / point.screenHeight;
            // this is the three.js coordinates of the point within the screen rect space
            const local = new THREE.Vector3((uvx - 0.5) * context.screenMeta.rectXDistance, (0.5 - uvy) * context.screenMeta.rectYDistance, 0);
            const worldPoint = local.clone();
            // this converts that to the world space
            context.screenRect.localToWorld(worldPoint);

            if (this.marker) {
                this.marker.position.copy(worldPoint);
                this.marker.visible = true;
            }

            const headsetPos = new THREE.Vector3();
            context.camera.getWorldPosition(headsetPos);

            const dir = worldPoint.clone().sub(headsetPos).normalize();

            const startOffset = 0.15;
            const start = headsetPos.clone().add(dir.clone().multiplyScalar(startOffset));

            const distance = headsetPos.distanceTo(worldPoint);
            const end = headsetPos.clone().add(dir.clone().multiplyScalar(distance * 0.8));

            if (this.pointer && this.pointer.geometry) {
                this.pointer.geometry.setFromPoints([ start, end ]);
                this.pointer.visible = true;
            }
        }
    },

    // Screen handling
    // Use context.canvas to draw, context.sendGameMessage to emit events.

    // Screen-side initialization.
    // context: { canvas, sendGameMessage }
    async startScreen(context) {
        const canvas = context.canvas;
        const ctx = canvas.getContext('2d');

        function pickAndSendPoint() {
            const x = Math.floor(Math.random() * canvas.width);
            const y = Math.floor(Math.random() * canvas.height);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'red';
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.fill();

            context.sendGameMessage({
                event: 'RANDOM_POINT',
                canvasX: x,
                canvasY: y,
                screenWidth: canvas.width,
                screenHeight: canvas.height
            });
        }

        setInterval(pickAndSendPoint, 3000);
    },

    // Optional per-frame Screen update. delta,time in seconds.
    // context: { canvas, sendGameMessage }
    updateScreen(delta, time, context) {
        // Optional per-frame screen logic
    },

    /*
        Incoming messages handler.

        All controller data is available directly in updateVR via context.controllers, 
        context.screenState, and context.screenMeta. Use sendGameMessage to communicate 
        between VR and screen clients when custom events are needed.

        Handle messages sent via `sendGameMessage` here as you like.
    */
    onMessage(msg) {
        if (!msg) return;

        if (msg.event === 'RANDOM_POINT') {
            this.latestPoint = msg;
        }

        console.log('game onMessage received', msg);
    }
};