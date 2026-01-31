import * as THREE from 'three';
import { XR_BUTTONS, XR_AXES } from 'gamepad-wrapper';
import { Text } from 'troika-three-text';

/*
  Game template

  RESERVED MESSAGE TYPES (do not use these as top-level `type` values in game messages):
    REGISTER_CLIENT, REGISTRATION_SUCCESS, REGISTRATION_ERROR,
    VR_CONTROLLER_STATE, NEW_CLIENT, CLIENT_DISCONNECTED,
    CALIBRATION_COMMIT, SCREEN_CALIBRATION, SCREEN_DISCONNECTED,
    GAME_EVENT, ERROR
*/

export default {
    // Instance variables here

    // VR handling
    // Use context.sendGameMessage(payload) to emit game events.

    // VR-side initialization hook.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage }
    async startVR(context) {
        // Called once on VR client after scene + calibration are ready.
        // Optional: show simple shooting feedback in VR (non-required).
        // We'll create a small visual indicator when the controller triggers,
        // but the actual hit detection is handled on the screen client
        // which receives forwarded `VR_CONTROLLER_STATE` messages.
        // Assume Three.js and a valid VR context are present in VR clients.
        const { scene, renderer } = context;
        this._vrMarkers = [];
        this._vrMarkerTTL = 0.35; // seconds
        this._projectiles = [];
        this._prevControllerTrigger = {};
        this._threeAvailable = true;
        this._threeScene = scene;
        this._threeMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage,
    //            screenState, screenMeta, screenRect }
    // - `screenState`: object with `right` and `left` entries, each `{ onScreen, canvasX, canvasY, uv }` (per-frame intersection)
    // - `screenMeta`: metadata snapshot `{ screenWidth, screenHeight, topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance }`
    // - `screenRect`: the THREE.Mesh used to represent the screen rect (optional)
    updateVR(delta, time, context) {
        // Optional per-frame VR logic
        // Update transient VR markers
        const remove = [];
        for (let i = 0; i < this._vrMarkers.length; i++) {
            const m = this._vrMarkers[i];
            m._age = (m._age || 0) + delta;
            if (m._age >= this._vrMarkerTTL) remove.push(i);
            else {
                const s = 1 + m._age * 3;
                m.scale.set(s, s, s);
                if (m.material && m.material.opacity !== undefined) m.material.opacity = Math.max(0, 1 - m._age / this._vrMarkerTTL);
            }
        }
        for (let i = remove.length - 1; i >= 0; i--) {
            const idx = remove[i];
            const m = this._vrMarkers.splice(idx, 1)[0];
            if (m.parent) m.parent.remove(m);
        }

        // Update projectiles
        const removeP = [];
        for (let i = 0; i < this._projectiles.length; i++) {
            const p = this._projectiles[i];
            p.life -= delta;
            const move = p.dir.clone().multiplyScalar(p.speed * delta);
            p.mesh.position.add(move);
            p.traveled = (p.traveled || 0) + move.length();
            if (p.life <= 0 || p.traveled > p.maxDist) removeP.push(i);
        }
        for (let i = removeP.length - 1; i >= 0; i--) {
            const idx = removeP[i];
            const p = this._projectiles.splice(idx, 1)[0];
            if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
        }

        // Spawn projectiles when triggers cross threshold (controllers: { right, left })
        const ctrlList = [context.controllers.right, context.controllers.left];
        for (let i = 0; i < ctrlList.length; i++) {
            const c = ctrlList[i];
            if (!c) continue;
            const gp = c.gamepad;
            const triggerVal = gp.getButton(XR_BUTTONS.TRIGGER) || 0;
            const prev = this._prevControllerTrigger[i] || 0;
            if (triggerVal > 0.1 && prev <= 0.5) {
                const pos = c.raySpace.position.clone();
                const dir = new THREE.Vector3(0,0,-1).applyQuaternion(c.raySpace.quaternion).normalize();
                const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
                mesh.position.copy(pos);
                this._threeScene.add(mesh);
                this._projectiles.push({ mesh, dir, speed: 4.0, life: 2.0, maxDist: 8.0, traveled: 0 });

                const mk = new THREE.Mesh(new THREE.SphereGeometry(0.01,6,6), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
                mk.position.copy(c.raySpace.position);
                this._threeScene.add(mk);
                mk._age = 0;
                this._vrMarkers.push(mk);
            }
            this._prevControllerTrigger[i] = triggerVal;
        }
    },

    // Screen handling
    // Use context.canvas to draw, context.sendGameMessage to emit events.

    // Screen-side initialization.
    // context: { canvas, sendGameMessage }
    async startScreen(context) {
        // Called once on Screen after registration and canvas creation.
        // Initialize target shooting game state on the screen canvas.
        const canvas = context.canvas;
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._targets = [];
        this._shots = [];
        this._scores = {};
        this._lastTrigger = {};
        this._targetImg = new Image();
        this._targetImg.src = 'assets/target.png';
        this._targetRadius = Math.floor(Math.min(canvas.width, canvas.height) * 0.06) || 32;

        // Spawn a few targets
        for (let i = 0; i < 5; i++) this._spawnTarget(canvas);

        // Teleport targets around periodically
        this._teleportInterval = setInterval(() => {
            const idx = Math.floor(Math.random() * this._targets.length);
            this._respawnTarget(this._targets[idx], canvas);
        }, 1500 + Math.floor(Math.random() * 1500));
    },

    // Optional per-frame Screen update. delta,time in seconds.
    // context: { canvas, sendGameMessage }
    updateScreen(delta, time, context) {
        // Optional per-frame screen logic
        const canvas = context.canvas;
        const ctx = this._ctx || canvas.getContext('2d');
        if (!ctx) return;
        if (!this._targets) return;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw targets
        for (const t of this._targets) {
            const x = t.x;
            const y = t.y;
            const r = this._targetRadius;
            if (this._targetImg && this._targetImg.complete) {
                ctx.drawImage(this._targetImg, x - r, y - r, r * 2, r * 2);
            } else {
                // fallback: draw a red ring
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#c00';
                ctx.stroke();
            }
        }

        // Draw shots (visual feedback)
        const remainingShots = [];
        for (const s of this._shots) {
            s.life -= delta;
            if (s.life > 0) {
                const alpha = Math.max(0, s.life / s.maxLife);
                ctx.beginPath();
                ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255,220,0,${alpha})`;
                ctx.fill();
                remainingShots.push(s);
            }
        }
        this._shots = remainingShots;

        // Draw leaderboard top-left
        const scores = this._scores || {};
        const entries = Object.keys(scores).map(id => ({ id, score: scores[id] })).sort((a, b) => b.score - a.score);
        ctx.save();
        ctx.font = '16px sans-serif';
        ctx.fillStyle = '#000';
        ctx.fillText('Leaderboard', 14, 28);
        ctx.font = '14px sans-serif';
        let y = 50;
        for (const e of entries) {
            ctx.fillText(`${e.id}: ${e.score}`, 14, y);
            y += 20;
        }
        ctx.restore();
    },

    // Helper: spawn a new target inside the canvas bounds
    _spawnTarget(canvas) {
        canvas = canvas || this._canvas;
        if (!canvas) return null;
        this._targets = this._targets || [];
        const r = this._targetRadius || Math.floor(Math.min(canvas.width, canvas.height) * 0.06) || 32;
        const x = r + Math.random() * Math.max(1, canvas.width - 2 * r);
        const y = r + Math.random() * Math.max(1, canvas.height - 2 * r);
        const t = { x, y, id: `${Date.now()}-${Math.random()}` };
        this._targets.push(t);
        return t;
    },

    // Helper: respawn an existing target at a new random position
    _respawnTarget(target, canvas) {
        canvas = canvas || this._canvas;
        if (!canvas || !target) return;
        const r = this._targetRadius || Math.floor(Math.min(canvas.width, canvas.height) * 0.06) || 32;
        target.x = r + Math.random() * Math.max(1, canvas.width - 2 * r);
        target.y = r + Math.random() * Math.max(1, canvas.height - 2 * r);
    },

    /*
      Incoming messages handler.

      Forwarded VR controller `message` contains:
        controllerType, canvasX, canvasY, position, quaternion,
        topLeftCorner, bottomRightCorner, recontextDistance, rectYDistance,
        triggerButtonState, squeezeButtonState, button1State, button2State,
        thumbstickX, thumbstickY, userID

      Handle messages sent via `sendGameMessage` here as you like.
    */
    onMessage(msg) {
        if (!msg) return;

        // VR controller updates forwarded by the host
        if (msg.type === 'VR_CONTROLLER_STATE' && msg.message) {
            const state = msg.message;
            if (!state.canvasX || !state.canvasY) return;
            // state.canvasX / state.canvasY are pixel coords on the screen canvas
            const cx = state.canvasX;
            const cy = state.canvasY;
            const trigger = (state.triggerButtonState || 0);
            const uid = state.userID || 'unknown';

            // Visual and scoring logic runs only on screen clients (they receive these messages).
            // Detect trigger edge (pressed now, not pressed previously)
            const prev = this._lastTrigger && this._lastTrigger[uid];
            if (trigger > 0.5 && !prev) {
                console.log('Screen: shot received from', uid, 'at', cx, cy, 'trigger=', trigger);
                // register a shot visual
                if (typeof cx === 'number' && typeof cy === 'number') {
                    this._shots = this._shots || [];
                    this._shots.push({ x: cx, y: cy, life: 0.6, maxLife: 0.6 });

                    // check for hit
                    for (const t of this._targets) {
                        const dx = cx - t.x;
                        const dy = cy - t.y;
                        const dist2 = dx * dx + dy * dy;
                        const r = this._targetRadius || 32;
                        if (dist2 <= r * r) {
                            // hit!
                            this._scores = this._scores || {};
                            this._scores[uid] = (this._scores[uid] || 0) + 1;
                            console.log('Screen: target hit by', uid, 'score=', this._scores[uid]);
                            // respawn this target
                            this._respawnTarget(t, this._canvas);
                            break; // one hit per shot
                        }
                    }
                }
            }
            this._lastTrigger = this._lastTrigger || {};
            this._lastTrigger[uid] = trigger > 0.5;
            return;
        }

        // New client connected
        if (msg.type === 'NEW_CLIENT' && msg.message) {
            const info = msg.message; // { type, userID }
            console.log('Client joined:', info.type, info.userID);
            return;
        }

        // Client disconnected
        if (msg.type === 'CLIENT_DISCONNECTED' && msg.message) {
            const info = msg.message; // { type, userID }
            console.log('Client left:', info.userID);
            return;
        }

        // Generic game-level payloads sent via sendGameMessage(payload)
        if (msg.type === 'GAME_EVENT' && msg.message) {
            const info = msg.message;

            // Handle your game messages here

            return;
        }

        // Fallback: raw payloads
        console.log('game onMessage received', msg);
    }
};