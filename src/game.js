import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

const SPHERE_RADIUS = 0.02;
const SPHERE_COLOR = 0xffee66;
const TARGET_RADIUS_PERCENT = 0.06;
const SHOT_FADE_TIME = 0.6;

export default {

    // Called once when VR client initializes
    // Sets up sphere material and tracking for flying projectiles
    async startVR(context) {
        this._vr = {};
        this._vr.scene = context.scene;
        this._vr.sendMessage = context.sendGameMessage;
        this._vr.activeSpheres = [];
        this._vr.sphereMaterial = new THREE.MeshBasicMaterial({ color: SPHERE_COLOR });
        // Generate unique player ID for this VR client
        this._vr.playerId = 'Player-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
    },


    // Called every frame on VR client
    // Checks for trigger press to spawn spheres, animates spheres toward screen
    updateVR(delta, time, context) {
        const sides = ['right', 'left'];

        // Check each controller for trigger press
        sides.forEach((side) => {
            const controller = context.controllers[side];
            const triggerPressed = controller.gamepad.getButtonDown(XR_BUTTONS.TRIGGER);

            if (triggerPressed) {
                const screenState = context.screenState[side];

                if (screenState.onScreen) {
                    this.spawnSphere(controller, screenState, context);
                }
            }
        });

        // Animate all active spheres
        this.updateSpheres(delta);
    },


    // Spawns a new sphere and starts it flying toward the screen hit point
    spawnSphere(controller, screenHit, context) {
        const startPosition = controller.gripSpace.position.clone();
        const targetPosition = screenHit.hitPoint.clone();
        const sphereGeometry = new THREE.SphereGeometry(SPHERE_RADIUS, 12, 10);
        const sphereMesh = new THREE.Mesh(sphereGeometry, this._vr.sphereMaterial.clone());

        sphereMesh.position.copy(startPosition);
        this._vr.scene.add(sphereMesh);

        const distance = startPosition.distanceTo(targetPosition);
        const speed = Math.max(2, distance * 0.8);

        this._vr.activeSpheres.push({
            mesh: sphereMesh,
            startPosition: startPosition,
            targetPosition: targetPosition,
            progress: 0,
            speed: speed,
            canvasX: screenHit.canvasX,
            canvasY: screenHit.canvasY,
            playerId: this._vr.playerId
        });
    },


    // Moves spheres toward target and sends SHOT event when they arrive
    updateSpheres(delta) {
        const toRemove = [];

        this._vr.activeSpheres.forEach((sphere, index) => {
            const totalDistance = sphere.startPosition.distanceTo(sphere.targetPosition);
            sphere.progress += delta * (sphere.speed / totalDistance);

            const t = Math.min(1, sphere.progress);
            sphere.mesh.position.lerpVectors(sphere.startPosition, sphere.targetPosition, t);

            // Sphere reached the screen
            if (t >= 1) {
                this._vr.sendMessage({
                    event: 'SHOT',
                    canvasX: sphere.canvasX,
                    canvasY: sphere.canvasY,
                    player: sphere.playerId
                });

                sphere.mesh.parent.remove(sphere.mesh);
                sphere.mesh.geometry.dispose();
                sphere.mesh.material.dispose();

                toRemove.push(index);
            }
        });

        for (let i = toRemove.length - 1; i >= 0; i--) {
            this._vr.activeSpheres.splice(toRemove[i], 1);
        }
    },


    // Called once when screen client initializes
    // Sets up canvas, targets, and click handler for testing
    async startScreen(context) {
        this._screen = {};
        this._screen.canvas = context.canvas;
        this._screen.ctx = context.canvas.getContext('2d');

        // Minimal sizing: assume host (screen) sizes the canvas (fullscreen + reload).
        // Read pixel size now and compute target radius — keep game code focused.
        const canvas = this._screen.canvas;
        this._screen.width = canvas.width || canvas.clientWidth;
        this._screen.height = canvas.height || canvas.clientHeight;
        this._screen.targetRadius = Math.floor(Math.min(this._screen.width, this._screen.height) * TARGET_RADIUS_PERCENT);
        this._screen.ctx.setTransform(1, 0, 0, 1, 0, 0);

        this._screen.targets = [];
        this._screen.shotVisuals = [];
        this._screen.scores = {};

        this._screen.targetImage = new Image();
        this._screen.targetImage.src = 'assets/target.png';

        // Spawn initial targets
        for (let i = 0; i < 5; i++) {
            this.createTarget();
        }

        // Randomly teleport targets every 1.5-3 seconds
        this._screen.teleportInterval = setInterval(() => {
            const randomIndex = Math.floor(Math.random() * this._screen.targets.length);
            this.repositionTarget(this._screen.targets[randomIndex]);
        }, 1500 + Math.floor(Math.random() * 1500));

        // Mouse click support for testing
        this._screen.canvas.addEventListener('click', (e) => {
            const rect = this._screen.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            this.registerShot(clickX, clickY, 'local');
        });
    },


    // Creates a new target at a random position
    createTarget() {
        const x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
        const y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);

        this._screen.targets.push({ x, y });
    },


    // Moves an existing target to a new random position
    repositionTarget(target) {
        target.x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
        target.y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);
    },


    // Called every frame on screen client
    // Draws targets, shot effects, and leaderboard
    updateScreen(delta, time, context) {
        if (!this._screen) {
            return;
        }

        const ctx = this._screen.ctx;

        // Clear and set white background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this._screen.canvas.width, this._screen.canvas.height);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, this._screen.width, this._screen.height);

        // Draw targets
        this.drawTargets(ctx);

        // Draw and update shot visuals
        this.drawShots(ctx, delta);

        // Draw leaderboard
        this.drawLeaderboard(ctx);
    },


    // Renders all targets on screen
    drawTargets(ctx) {
        const radius = this._screen.targetRadius;

        for (const target of this._screen.targets) {
            if (this._screen.targetImage.complete) {
                ctx.drawImage(
                    this._screen.targetImage,
                    target.x - radius,
                    target.y - radius,
                    radius * 2,
                    radius * 2
                );
            }
            else {
                // Fallback circle if image not loaded
                ctx.beginPath();
                ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#c00';
                ctx.stroke();
            }
        }
    },


    // Renders fading shot effects
    drawShots(ctx, delta) {
        const toRemove = [];

        for (let i = 0; i < this._screen.shotVisuals.length; i++) {
            const shot = this._screen.shotVisuals[i];
            shot.life -= delta;

            if (shot.life > 0) {
                const alpha = shot.life / SHOT_FADE_TIME;

                ctx.beginPath();
                ctx.arc(shot.x, shot.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 220, 0, ${alpha})`;
                ctx.fill();
            }
            else {
                toRemove.push(i);
            }
        }

        for (let i = toRemove.length - 1; i >= 0; i--) {
            this._screen.shotVisuals.splice(toRemove[i], 1);
        }
    },


    // Renders leaderboard at bottom-left
    drawLeaderboard(ctx) {
        ctx.save();

        ctx.fillStyle = '#000';
        ctx.font = '14px sans-serif';

        const scoreEntries = Object.keys(this._screen.scores).map(id => ({
            id: id,
            score: this._screen.scores[id]
        })).sort((a, b) => b.score - a.score);

        let yPosition = this._screen.height - 12;

        for (const entry of scoreEntries) {
            ctx.fillText(`${entry.id}: ${entry.score}`, 14, yPosition);
            yPosition -= 20;
        }

        ctx.font = '16px sans-serif';
        ctx.fillText('Leaderboard', 14, yPosition - 6);

        ctx.restore();
    },


    // Handles incoming messages from VR client
    onMessage(msg) {
        if (!this._screen) {
            return;
        }

        if (msg.event === 'SHOT') {
            this.registerShot(msg.canvasX, msg.canvasY, msg.player);
        }
    },


    // Registers a shot, creates visual effect, and checks for target hits
    registerShot(x, y, playerId) {
        // Add visual effect
        this._screen.shotVisuals.push({
            x: x,
            y: y,
            life: SHOT_FADE_TIME
        });

        // Check for target hits
        for (const target of this._screen.targets) {
            const dx = x - target.x;
            const dy = y - target.y;
            const distanceSquared = dx * dx + dy * dy;
            const radiusSquared = this._screen.targetRadius * this._screen.targetRadius;

            if (distanceSquared <= radiusSquared) {
                this._screen.scores[playerId] = (this._screen.scores[playerId] || 0) + 1;
                this.repositionTarget(target);
                break;
            }
        }
    }

};