import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

/*
    Game: VR shooting -> screen particle effects
*/

export default {
    // Instance variables here

    // VR handling
    // Use context.sendGameMessage(payload) to emit game events.

    // VR-side initialization hook.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage }
    async startVR(context) {
        // Called once on VR client after scene + calibration are ready.
        // Keep local state for shot visuals
        this._vr = this._vr || {};
        this._vr.scene = context.scene;
        this._vr.sendGameMessage = context.sendGameMessage;
        this._vr.controllers = context.controllers;
        this._vr.prevTrigger = { right: 0, left: 0 };
        this._vr.shots = [];
        // sphere material
        // use a non-lit basic material so the sphere appears bright in all lighting
        this._vr.sphereMat = new THREE.MeshBasicMaterial({ color: 0xffee66 });
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage,
    //            screenState, screenMeta, screenRect }
    // - `screenState`: object with `right` and `left` entries, each `{ onScreen, canvasX, canvasY, uv }` (per-frame intersection)
    // - `screenMeta`: metadata snapshot `{ screenWidth, screenHeight, topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance }`
    // - `screenRect`: the THREE.Mesh used to represent the screen rect (optional)
    updateVR(delta, time, context) {
        // Manage local shot spheres and detect trigger presses
        try {
            if (!this._vr) return;
            // determine current screen mode (set by screen via MODE GAME_EVENT)
            const screenMode = this._vr.screenMode || (this._screen && this._screen.mode) || 'menu';
            const sides = ['right', 'left'];
            sides.forEach((side) => {
                const ctrl = context.controllers && context.controllers[side];
                if (!ctrl || !ctrl.gamepad) return;
                let trigger = 0;
                try { trigger = typeof ctrl.gamepad.getButton === 'function' ? ctrl.gamepad.getButton(XR_BUTTONS.TRIGGER) : (ctrl.gamepad.buttons && ctrl.gamepad.buttons[0] && ctrl.gamepad.buttons[0].value) || 0; } catch (e) { trigger = 0; }
                const prev = this._vr.prevTrigger[side] || 0;
                // Detect press (rising edge)
                if (prev <= 0.5 && trigger > 0.5) {
                    // If ray is hitting screen, create a shot and notify screen to spawn particles
                    const hit = context.screenState && context.screenState[side];
                    if (hit && hit.onScreen && Number.isFinite(hit.canvasX) && Number.isFinite(hit.canvasY) && context.screenRect) {
                        // compute world hit point on the screen mesh
                        const rayOrigin = ctrl.gripSpace ? ctrl.gripSpace.position.clone() : (ctrl.raySpace ? ctrl.raySpace.position.clone() : null);
                        const rayDir = ctrl.raySpace ? new THREE.Vector3(0,0,-1).applyQuaternion(ctrl.raySpace.quaternion).normalize() : null;
                        let hitPoint = null;
                        if (rayOrigin && rayDir && context.screenRect) {
                            const raycaster = new THREE.Raycaster();
                            raycaster.set(rayOrigin, rayDir);
                            const ints = raycaster.intersectObject(context.screenRect);
                            if (ints && ints.length) hitPoint = ints[0].point.clone();
                        }

                        // Spawn VR sphere shot (only for non-draw demo)
                        if (hitPoint && this._vr.scene && screenMode !== 'demo2') {
                            const geo = new THREE.SphereGeometry(0.02, 12, 10);
                            const mesh = new THREE.Mesh(geo, this._vr.sphereMat.clone());
                            const startPos = (ctrl.gripSpace && ctrl.gripSpace.position) ? ctrl.gripSpace.position.clone() : (ctrl.raySpace ? ctrl.raySpace.position.clone() : new THREE.Vector3());
                            mesh.position.copy(startPos);
                            this._vr.scene.add(mesh);
                            const dist = startPos.distanceTo(hitPoint) || 1.0;
                            // slower travel: scale speed by distance but keep reasonable minimum
                            const speed = Math.max(2, dist * 0.8);
                            this._vr.shots.push({ mesh, start: startPos.clone(), target: hitPoint.clone(), progress: 0, speed });
                        }

                        // Notify screen to spawn particles at canvas coords
                        try {
                            this._vr.sendGameMessage({ event: 'SHOT', canvasX: hit.canvasX, canvasY: hit.canvasY });
                        } catch (e) {}
                    }
                }
                this._vr.prevTrigger[side] = trigger;
            });

            // Update active shots
            const remove = [];
            this._vr.shots.forEach((s, idx) => {
                if (!s.mesh) return remove.push(idx);
                const totalDist = s.start.distanceTo(s.target) || 1e-6;
                s.progress += delta * (s.speed / totalDist);
                const t = Math.min(1, s.progress);
                s.mesh.position.lerpVectors(s.start, s.target, t);
                // scale & fade out near end
                const scale = 1 + t * 0.8;
                s.mesh.scale.setScalar(scale);
                if (t >= 1) {
                    if (s.mesh.parent) s.mesh.parent.remove(s.mesh);
                    if (s.mesh.geometry) s.mesh.geometry.dispose();
                    if (s.mesh.material) s.mesh.material.dispose();
                    remove.push(idx);
                }
            });
            // remove in reverse order
            for (let i = remove.length - 1; i >= 0; i--) this._vr.shots.splice(remove[i], 1);
        } catch (e) {
            console.warn('updateVR shot error', e);
        }
    },

    // Screen handling
    // Use context.canvas to draw, context.sendGameMessage to emit events.

    // Screen-side initialization.
    // context: { canvas, sendGameMessage }
    async startScreen(context) {
        // Called once on Screen after registration and canvas creation.
        // Setup particle canvas system
        this._screen = this._screen || {};
        const canvas = context.canvas;
        const dpr = window.devicePixelRatio || 1;
        this._screen.canvas = canvas;
        this._screen.ctx = canvas.getContext('2d');
        this._screen.dpr = dpr;
        // ensure proper backing store size
        const resize = () => {
            const w = canvas.clientWidth || canvas.width;
            const h = canvas.clientHeight || canvas.height;
            // cap backing store to avoid exceeding browser maximum texture/canvas size
            const MAX_BACKING = 8192; // safe default for many browsers
            // compute an effective devicePixelRatio that keeps w*effDpr <= MAX_BACKING and h*effDpr <= MAX_BACKING
            const maxDim = Math.max(1, w, h);
            const effDpr = Math.max(1, Math.min(dpr, Math.floor(MAX_BACKING / maxDim)));
            canvas.width = Math.floor(w * effDpr);
            canvas.height = Math.floor(h * effDpr);
            // ensure CSS size matches measured layout so client coord math aligns
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            // store effective dpr for drawing
            this._screen.dpr = effDpr;
            // clear button bottom-left (CSS pixels)
            this._screen.clearButton = { x: 12, y: h - 48, w: 90, h: 36 };
            // scale drawing so we can use CSS pixel units like the CodePen
            const ctx2 = canvas.getContext('2d');
            ctx2.setTransform(effDpr, 0, 0, effDpr, 0, 0);
        };
        resize();
        this._screen.resize = resize;
        this._screen.particles = [];
        this._screen.circles = [];
            this._screen.controllerStates = {};
            this._screen.drawDots = [];
            this._screen.lastDrawTimes = { right: 0, left: 0 };
        // preload target image for demo3
        this._screen.targetImg = new Image();
        this._screen.targetImg.src = 'assets/target.png';
        // UI state: menu with three demos
        this._screen.mode = 'menu';
        this._screen.buttons = [];
        this._screen.backButton = { x: 12, y: 12, w: 90, h: 36 };
        this._screen.spawnParticles = (x, y) => {
            // Firework-style, matching original CodePen sizes and timing
            const pcount = 30;
            // origin in CSS pixels (we scaled ctx to DPR so use CSS coords)
            const originX = (typeof x === 'number') ? x : 0;
            const originY = (typeof y === 'number') ? y : 0;
            // circle visual (radius in CSS px)
            const circleLife = 1200 + Math.random() * 600; // ms (1200-1800)
            this._screen.circles.push({ x: originX, y: originY, radius: 0.1, targetRadius: (80 + Math.random() * 80), lineWidth: 6, alpha: 0.5, life: circleLife / 1000, alphaDuration: (600 + Math.random() * 200) / 1000, age: 0 });
            for (let i = 0; i < pcount; i++) {
                const angle = (Math.PI * 2) * (i / pcount) + (Math.random() - 0.5) * 0.6;
                // distance similar to CodePen (50-180 CSS px)
                const dist = 50 + Math.random() * 130;
                const endX = originX + Math.cos(angle) * dist;
                const endY = originY + Math.sin(angle) * dist;
                // particle life 1200-1800 ms
                const life = (1200 + Math.random() * 600) / 1000;
                const hue = Math.floor(Math.random() * 360);
                const startRadius = 16 + Math.random() * 16; // 16-32 like CodePen
                this._screen.particles.push({
                    startX: originX, startY: originY,
                    endX, endY,
                    x: originX, y: originY,
                    startRadius, radius: startRadius,
                    life, age: 0, hue
                });
            }
        };

        // mouse handling for menu & demos (CSS pixel coordinates)
        const onClick = (e) => {
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            if (this._screen.mode === 'menu') {
                // check buttons
                for (let i = 0; i < this._screen.buttons.length; i++) {
                    const b = this._screen.buttons[i];
                    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
                        this._screen.mode = b.target;
                        // notify other clients (VR) about mode change
                        try { if (context && typeof context.sendGameMessage === 'function') context.sendGameMessage({ event: 'MODE', mode: this._screen.mode }); } catch (e) {}
                        // clear existing particles
                        this._screen.particles.length = 0;
                        this._screen.circles.length = 0;
                        // initialize demo3 target game if applicable
                        if (this._screen.mode === 'demo3') {
                            // setup simple target game state on the screen
                            this._screen.targetGame = this._screen.targetGame || {};
                            const tg = this._screen.targetGame;
                            tg.targets = [];
                            tg.shots = [];
                            tg.scores = {};
                            tg.lastTrigger = {};
                            tg.spawnTarget = (canvasLocal) => {
                                const cw = (canvasLocal && canvasLocal.clientWidth) || (canvas && canvas.clientWidth) || 800;
                                const ch = (canvasLocal && canvasLocal.clientHeight) || (canvas && canvas.clientHeight) || 600;
                                const r = Math.floor(Math.min(cw, ch) * 0.06) || 32;
                                const x = r + Math.random() * Math.max(1, cw - 2 * r);
                                const y = r + Math.random() * Math.max(1, ch - 2 * r);
                                const tObj = { x, y, id: `${Date.now()}-${Math.random()}` };
                                tg.targets.push(tObj);
                                return tObj;
                            };
                            tg.respawnTarget = (tObj, canvasLocal) => {
                                const cw = (canvasLocal && canvasLocal.clientWidth) || (canvas && canvas.clientWidth) || 800;
                                const ch = (canvasLocal && canvasLocal.clientHeight) || (canvas && canvas.clientHeight) || 600;
                                const r = Math.floor(Math.min(cw, ch) * 0.06) || 32;
                                tObj.x = r + Math.random() * Math.max(1, cw - 2 * r);
                                tObj.y = r + Math.random() * Math.max(1, ch - 2 * r);
                            };
                            // spawn initial targets
                            for (let i = 0; i < 5; i++) tg.spawnTarget(canvas);
                            // teleport interval
                            if (tg._teleportInterval) clearInterval(tg._teleportInterval);
                            tg._teleportInterval = setInterval(() => {
                                if (!tg.targets || !tg.targets.length) return;
                                const idx = Math.floor(Math.random() * tg.targets.length);
                                tg.respawnTarget(tg.targets[idx], canvas);
                            }, 1500 + Math.floor(Math.random() * 1500));
                        } else {
                            // if leaving demo3, cleanup teleport interval
                            if (this._screen.targetGame && this._screen.targetGame._teleportInterval) {
                                clearInterval(this._screen.targetGame._teleportInterval);
                                delete this._screen.targetGame._teleportInterval;
                            }
                        }
                        return;
                    }
                }
            } else {
                // in demo: check back button
                const b = this._screen.backButton;
                if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
                    this._screen.mode = 'menu';
                    this._screen.particles.length = 0;
                    this._screen.circles.length = 0;
                    // notify VR of mode change
                    try { if (context && typeof context.sendGameMessage === 'function') context.sendGameMessage({ event: 'MODE', mode: this._screen.mode }); } catch (e) {}
                    // cleanup demo3 interval if present
                    if (this._screen.targetGame && this._screen.targetGame._teleportInterval) {
                        clearInterval(this._screen.targetGame._teleportInterval);
                        delete this._screen.targetGame._teleportInterval;
                    }
                    return;
                }
                    // check clear button for draw demo
                    if (this._screen.mode === 'demo2') {
                        const cb = this._screen.clearButton;
                        if (cx >= cb.x && cx <= cb.x + cb.w && cy >= cb.y && cy <= cb.y + cb.h) {
                            // clear drawn dots
                            this._screen.drawDots.length = 0;
                            return;
                        }
                    }
                // otherwise spawn particles in current demo (only demo1 and demo3)
                if (this._screen.mode === 'demo1' || this._screen.mode === 'demo3') {
                    this._screen.spawnParticles(cx, cy);
                }
            }
        };
        canvas.addEventListener('click', onClick);

        // build menu buttons positions (update on resize)
        const buildButtons = () => {
            const w = canvas.clientWidth || 800;
            const h = canvas.clientHeight || 600;
            const bw = 320, bh = 72, gap = 24;
            const startY = (h - (3 * bh + 2 * gap)) / 2;
            const cx = (w - bw) / 2;
            this._screen.buttons = [
                { x: cx, y: startY, w: bw, h: bh, label: 'Particles', target: 'demo1' },
                { x: cx, y: startY + (bh + gap), w: bw, h: bh, label: 'Drawing', target: 'demo2' },
                { x: cx, y: startY + 2 * (bh + gap), w: bw, h: bh, label: 'Targets', target: 'demo3' }
            ];
            // back button stays small in corner
            this._screen.backButton = { x: 12, y: 12, w: 90, h: 36 };
        };
        buildButtons();
        // rebuild on resize
        const resizeObserver = () => buildButtons();
        this._screen.resizeObserver = resizeObserver;
        window.addEventListener('resize', resizeObserver);
        // announce initial mode to other clients (VR) so they can adjust visuals
        try { if (context && typeof context.sendGameMessage === 'function') context.sendGameMessage({ event: 'MODE', mode: this._screen.mode }); } catch (e) {}
    },

    // Optional per-frame Screen update. delta,time in seconds.
    // context: { canvas, sendGameMessage }
    updateScreen(delta, time, context) {
        // Update and draw particles (firework style)
        if (!this._screen || !this._screen.ctx) return;
        // defensive defaults in case startScreen hasn't fully initialized
        this._screen.particles = this._screen.particles || [];
        this._screen.circles = this._screen.circles || [];
        this._screen.buttons = this._screen.buttons || [];
        this._screen.backButton = this._screen.backButton || { x: 12, y: 12, w: 90, h: 36 };
        this._screen.clearButton = this._screen.clearButton || { x: 12, y: (this._screen.canvas ? (this._screen.canvas.clientHeight - 48) : 600), w: 90, h: 36 };
        this._screen.controllerStates = this._screen.controllerStates || {};
        this._screen.drawDots = this._screen.drawDots || [];
        const ctx = this._screen.ctx;
        const canvas = this._screen.canvas;
        const dpr = this._screen.dpr || 1;
        if (typeof this._screen.resize === 'function') this._screen.resize();
        // Clear entire canvas each frame (like the CodePen)
        // Reset transform to clear full backing store, then restore CSS-scale transform
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr,0,0,dpr,0,0);
        // fill background white in CSS pixels
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        // draw persistent drawDots (for demo2)
        if (this._screen.mode === 'demo2') {
            // render saved dots
            ctx.save();
            for (let i = 0; i < this._screen.drawDots.length; i++) {
                const d = this._screen.drawDots[i];
                ctx.beginPath();
                ctx.fillStyle = d.color;
                ctx.arc(d.x, d.y, d.r || 6, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            // handle controller continuous drawing
            const now = time || 0;
            const sides = ['right', 'left'];
            sides.forEach((side) => {
                const st = (this._screen.controllerStates && this._screen.controllerStates[side]) || null;
                if (!st) return;
                if (st.onScreen && Number.isFinite(st.canvasX) && Number.isFinite(st.canvasY)) {
                    // draw cursor
                    const col = side === 'right' ? '#FF1461' : '#5A87FF';
                    ctx.beginPath(); ctx.fillStyle = col; ctx.globalAlpha = 0.6; ctx.arc(st.canvasX, st.canvasY, 8, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1;
                    // if trigger held, add dot at interval
                    const trig = st.triggerButtonState || 0;
                    const last = this._screen.lastDrawTimes[side] || 0;
                    if (trig > 0.5 && (now - last) >= 0.03) {
                        this._screen.drawDots.push({ x: st.canvasX, y: st.canvasY, color: col, r: 6 });
                        this._screen.lastDrawTimes[side] = now;
                    }
                }
            });
        }

        // draw target-game (demo3)
        if (this._screen.mode === 'demo3') {
            const tg = this._screen.targetGame || { targets: [], shots: [], scores: {} };
            // draw targets
            const r = Math.floor(Math.min(this._screen.canvas.clientWidth || 800, this._screen.canvas.clientHeight || 600) * 0.06) || 32;
            for (const t of (tg.targets || [])) {
                if (this._screen.targetImg && this._screen.targetImg.complete) {
                    ctx.drawImage(this._screen.targetImg, t.x - r, t.y - r, r * 2, r * 2);
                } else {
                    ctx.beginPath();
                    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
                    ctx.fillStyle = '#fff';
                    ctx.fill();
                    ctx.lineWidth = 4;
                    ctx.strokeStyle = '#c00';
                    ctx.stroke();
                }
            }
            // draw shots
            if (tg.shots) {
                const remS = [];
                for (let si = 0; si < tg.shots.length; si++) {
                    const s = tg.shots[si];
                    s.life = (s.life || 0) - delta;
                    if (s.life > 0) {
                        const alpha = Math.max(0, s.life / (s.maxLife || 0.6));
                        ctx.beginPath();
                        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(255,220,0,${alpha})`;
                        ctx.fill();
                    } else remS.push(si);
                }
                for (let i = remS.length - 1; i >= 0; i--) tg.shots.splice(remS[i], 1);
            }
            // draw leaderboard at bottom-left
            ctx.save();
            ctx.fillStyle = '#000';
            const entries = Object.keys(tg.scores || {}).map(id => ({ id, score: tg.scores[id] })).sort((a,b) => b.score - a.score);
            const ch = (this._screen.canvas && this._screen.canvas.clientHeight) || 600;
            ctx.font = '14px sans-serif';
            let yy = ch - 12;
            for (const e of entries) { ctx.fillText(`${e.id}: ${e.score}`, 14, yy); yy -= 20; }
            ctx.font = '16px sans-serif';
            ctx.fillText('Leaderboard', 14, Math.max(14, yy - 6));
            ctx.restore();
        }

        // update circles
        const remCircles = [];
        for (let ci = 0; ci < this._screen.circles.length; ci++) {
            const c = this._screen.circles[ci];
            c.age += delta;
            const t = Math.min(1, c.age / c.life);
            // ease out
            const et = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
            c.radius = c.targetRadius * et;
            c.alpha = Math.max(0, 0.6 * (1 - t));
            // draw
            ctx.beginPath();
            ctx.globalAlpha = c.alpha;
            ctx.lineWidth = c.lineWidth * (1 - t);
            ctx.strokeStyle = `rgba(0,0,0,${c.alpha})`;
            ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (t >= 1) remCircles.push(ci);
        }
        for (let i = remCircles.length - 1; i >= 0; i--) this._screen.circles.splice(remCircles[i], 1);

        // update particles
        const rem = [];
        for (let i = 0; i < this._screen.particles.length; i++) {
            const p = this._screen.particles[i];
            p.age += delta;
            const t = Math.min(1, p.age / p.life);
            // ease out expo for motion
            const et = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
            p.x = p.startX + (p.endX - p.startX) * et;
            p.y = p.startY + (p.endY - p.startY) * et;
            p.radius = p.startRadius * (1 - et);
            const alpha = Math.max(0, 1 - t);
            const hue = p.hue;
            // draw particle
            ctx.beginPath();
            ctx.fillStyle = `hsla(${hue},100%,60%,${alpha})`;
            ctx.arc(p.x, p.y, Math.max(0.5, p.radius), 0, Math.PI * 2);
            ctx.fill();
            if (t >= 1) rem.push(i);
        }
        for (let i = rem.length - 1; i >= 0; i--) this._screen.particles.splice(rem[i], 1);

        // UI rendering: menu or back button
        // draw menu
        if (this._screen.mode === 'menu') {
            // semi-dark background
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            // draw buttons
            ctx.font = '22px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            this._screen.buttons.forEach((b) => {
                // button rect
                ctx.beginPath();
                ctx.fillStyle = '#222';
                roundRect(ctx, b.x, b.y, b.w, b.h, 10, true, false);
                // highlight border
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#fff';
                ctx.stroke();
                // label
                ctx.fillStyle = '#fff';
                ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
            });
        } else {
            // draw small back button in corner
            const bb = this._screen.backButton;
            ctx.beginPath();
            ctx.fillStyle = '#222';
            roundRect(ctx, bb.x, bb.y, bb.w, bb.h, 6, true, false);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('< Back', bb.x + 10, bb.y + bb.h / 2);
            // clear button for draw demo
            if (this._screen.mode === 'demo2') {
                const cb = this._screen.clearButton;
                ctx.beginPath();
                ctx.fillStyle = '#222';
                roundRect(ctx, cb.x, cb.y, cb.w, cb.h, 6, true, false);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#fff';
                ctx.stroke();
                ctx.fillStyle = '#fff';
                ctx.font = '16px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText('Clear', cb.x + 12, cb.y + cb.h / 2);
            }
        }
    },

    /*
        Incoming messages handler.

        Forwarded VR controller `message` contains (when a controller ray intersects the screen):
            - controllerType: 'right'|'left'
            - canvasX, canvasY: pixel coordinates on the screen canvas (only present if `onScreen` is true)
            - onScreen: boolean indicating whether the ray intersected the screen rect
            - position, quaternion: controller pose (grip space)
            - topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance: screen rect geometry
            - triggerButtonState, squeezeButtonState, button1State, button2State: button values
            - thumbstickX, thumbstickY: axis values
            - userID: originating user id (if present)

        Additionally, the VR-side `updateVR` context receives `screenState` and `screenMeta` for per-frame intersection and metadata.

        Handle messages sent via `sendGameMessage` here as you like.
    */
    onMessage(msg) {
        if (!msg) return;

        // VR controller updates forwarded by the host
        // Sends canvasX and canvasY if controller raycast intersects screen
        if (msg.type === 'VR_CONTROLLER_STATE' && msg.message) {
            const state = msg.message;
            // state.canvasX / state.canvasY are pixel coords on the screen canvas
            // Example: detect trigger press
            const trigger = state.triggerButtonState || 0;
            try {
                this._screen = this._screen || {};
                if (!this._screen.prevTrigger) this._screen.prevTrigger = { right: 0, left: 0 };
                const side = state.controllerType || 'right';
                // store latest controller state for draw demo
                this._screen.controllerStates = this._screen.controllerStates || {};
                this._screen.controllerStates[side] = state;
                // If we're in the draw demo, handle drawing differently (no fireworks spawn)
                if (this._screen.mode === 'demo2') {
                    // consume for drawing in update loop
                    this._screen.prevTrigger[side] = trigger;
                    return;
                }
                // If we're in the target game (demo3), handle scoring/hits here
                if (this._screen.mode === 'demo3') {
                    try {
                        const uid = state.userID || 'unknown';
                        this._screen.targetGame = this._screen.targetGame || { targets: [], shots: [], scores: {}, lastTrigger: {} };
                        const tg = this._screen.targetGame;
                        const prevTrig = tg.lastTrigger && tg.lastTrigger[uid];
                        if (trigger > 0.5 && !prevTrig) {
                            // register a shot visual
                            tg.shots = tg.shots || [];
                            tg.shots.push({ x: state.canvasX, y: state.canvasY, life: 0.6, maxLife: 0.6 });
                            // check for hits
                            const r = Math.floor(Math.min((this._screen.canvas && this._screen.canvas.clientWidth) || 800, (this._screen.canvas && this._screen.canvas.clientHeight) || 600) * 0.06) || 32;
                            for (const t of (tg.targets || [])) {
                                const dx = state.canvasX - t.x;
                                const dy = state.canvasY - t.y;
                                const dist2 = dx * dx + dy * dy;
                                if (dist2 <= r * r) {
                                    tg.scores = tg.scores || {};
                                    tg.scores[uid] = (tg.scores[uid] || 0) + 1;
                                    // respawn target
                                    tg.respawnTarget && tg.respawnTarget(t, this._screen.canvas);
                                    break;
                                }
                            }
                        }
                        tg.lastTrigger = tg.lastTrigger || {};
                        tg.lastTrigger[uid] = trigger > 0.5;
                    } catch (e) {}
                    return;
                }
                // For other demos, previous behavior: spawn fireworks on trigger rising edge (demo1 & demo3 handled elsewhere)
                const prev = this._screen.prevTrigger[side] || 0;
                if (prev <= 0.5 && trigger > 0.5) {
                    if (state.canvasX !== undefined && state.canvasY !== undefined) {
                        if (this._screen && this._screen.spawnParticles) {
                            // only spawn particles for demo1 and demo3
                            if (this._screen.mode === 'demo1' || this._screen.mode === 'demo3') this._screen.spawnParticles(state.canvasX, state.canvasY);
                        }
                    }
                }
                this._screen.prevTrigger[side] = trigger;
            } catch (e) {}
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
        // GAME_EVENT forwarded payloads may arrive either wrapped or as raw payload
        if ((msg.type === 'GAME_EVENT' && msg.message) || (msg && msg.event)) {
            const info = msg.type === 'GAME_EVENT' && msg.message ? msg.message : msg;
            // handle shot events from VR
            try {
                if (info && info.event === 'MODE') {
                    // record screen mode for VR clients and screens
                    this._vr = this._vr || {};
                    this._vr.screenMode = info.mode;
                    this._screen = this._screen || {};
                    this._screen.mode = info.mode;
                    return;
                }
                if (info && info.event === 'SHOT' && this._screen && this._screen.spawnParticles) {
                    // only spawn fireworks when in demo1
                    if (this._screen.mode === 'demo1') {
                        this._screen.spawnParticles(info.canvasX, info.canvasY);
                    }
                }
            } catch (e) {}

            return;
        }

        // Fallback: raw payloads
        console.log('game onMessage received', msg);
    }
};

// helper: rounded rect using current ctx transform (expects CSS pixels)
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    if (typeof r === 'undefined') r = 5;
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    else { r = Object.assign({ tl: 0, tr: 0, br: 0, bl: 0 }, r); }
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    ctx.lineTo(x + r.bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}