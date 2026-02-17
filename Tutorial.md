# Building Your First WebXR Game: Target Shooter Tutorial

This tutorial uses a simple target shooting game to cover how to handle VR controllers, draw on a screen canvas, communicate between VR and screen clients, and implement game logic.

## Overview

- VR players point at a screen and shoot spheres by pulling the trigger
- The screen displays targets that move randomly
- Players score points by hitting targets
- A leaderboard tracks all players' scores

---

## Step 1: Shooting Spheres from VR Controllers

Let's start by making VR controllers spawn and shoot spheres toward the screen.

### 1.1 Set Up VR Initialization

First, we'll initialize variables to track our spheres and set up materials.

```javascript
import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

const SPHERE_RADIUS = 0.02;
const SPHERE_COLOR = 0xffee66;

export default {
    async startVR(context) {
        this._vr = {};
        this._vr.scene = context.scene;
        this._vr.sendMessage = context.sendGameMessage;
        this._vr.activeSpheres = [];
        this._vr.sphereMaterial = new THREE.MeshBasicMaterial({ color: SPHERE_COLOR });
        this._vr.playerId = 'Player-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
    },

    updateVR(delta, time, context) {
        // We'll add logic here next
    },

    async startScreen(context) {},
    updateScreen(delta, time, context) {},
    onMessage(msg) {}
};
```

**What's happening:**
- `this._vr` stores all VR-related state
- `activeSpheres` will track spheres currently flying
- `sphereMaterial` is created once and reused for performance
- `playerId` gives this VR client a unique identifier

### 1.2 Detect Trigger Presses

Now let's detect when the player pulls the trigger and check if they're pointing at the screen.

```javascript
updateVR(delta, time, context) {
    const sides = ['right', 'left'];

    sides.forEach((side) => {
        const controller = context.controllers[side];
        const triggerPressed = controller.gamepad.getButtonDown(XR_BUTTONS.TRIGGER);

        if (triggerPressed) {
            const screenState = context.screenState[side];
            
            if (screenState.onScreen) {
                console.log('Trigger pressed while pointing at screen!');
                // We'll spawn a sphere here next
            }
        }
    });
},
```

**What's happening:**
- We check both left and right controllers
- `getButtonDown()` returns true only on the frame the trigger is pressed (not held)
- `screenState.onScreen` tells us if the controller ray is hitting the screen
- `screenState` also contains the exact hit point coordinates

### 1.3 Spawn Spheres

Let's create a function that spawns a sphere and makes it fly toward where the controller is pointing.

```javascript
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
```

And call it from `updateVR`:

```javascript
if (screenState.onScreen) {
    this.spawnSphere(controller, screenState, context);
}
```

**What's happening:**
- We create a sphere at the controller's position
- We calculate the distance and speed for smooth animation
- We store canvas coordinates (where the sphere will hit on the 2D screen)
- Each sphere tracks its progress from 0 to 1

### 1.4 Animate Spheres

Now let's make the spheres fly toward their targets.

```javascript
updateSpheres(delta) {
    const toRemove = [];

    this._vr.activeSpheres.forEach((sphere, index) => {
        const totalDistance = sphere.startPosition.distanceTo(sphere.targetPosition);
        sphere.progress += delta * (sphere.speed / totalDistance);

        const t = Math.min(1, sphere.progress);
        sphere.mesh.position.lerpVectors(sphere.startPosition, sphere.targetPosition, t);

        if (t >= 1) {
            // Sphere reached the screen
            console.log('Sphere hit screen at', sphere.canvasX, sphere.canvasY);
            
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
```

Call this from `updateVR`:

```javascript
updateVR(delta, time, context) {
    // ... trigger detection code ...

    this.updateSpheres(delta);
},
```

**What's happening:**
- `lerpVectors` smoothly interpolates the sphere's position
- When progress reaches 1, the sphere has arrived
- We properly dispose of THREE.js objects to prevent memory leaks
- We remove spheres from the back of the array to avoid index issues

**Test it:** Run the game and pull the trigger while pointing at the screen. You should see yellow spheres fly toward the screen and disappear when they arrive!

---

## Step 2: Drawing Targets on the Screen

Now let's set up the screen client to display targets that players can shoot.

### 2.1 Initialize the Screen Canvas

```javascript
const TARGET_RADIUS_PERCENT = 0.06;

async startScreen(context) {
    this._screen = {};
    this._screen.canvas = context.canvas;
    this._screen.ctx = context.canvas.getContext('2d');

    this.resizeCanvas();

    this._screen.targets = [];
    this._screen.targetImage = new Image();
    this._screen.targetImage.src = 'assets/target.png';
},
```

**What's happening:**
- We store references to the canvas and its 2D context
- `resizeCanvas()` will handle proper DPI scaling
- We'll store target positions in an array
- We load a target image (the framework provides this asset)

### 2.2 Handle Canvas Resizing (simple)

For this tutorial we'll keep canvas resizing straightforward to reduce complexity. The canvas will use 1:1 pixel sizing (no DPR scaling) so the math and drawing are easier to follow.

```javascript
resizeCanvas() {
    const canvas = this._screen.canvas;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    // Use simple 1:1 pixel sizing to keep the tutorial easy to follow
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    this._screen.width = width;
    this._screen.height = height;
    this._screen.targetRadius = Math.floor(Math.min(width, height) * TARGET_RADIUS_PERCENT);

    // Ensure default transform
    this._screen.ctx.setTransform(1, 0, 0, 1, 0, 0);
},
```

**What's happening:**
- The canvas is sized to match its CSS layout size (clientWidth/clientHeight)
- We calculate target size as a percentage of the canvas size
- No DPR math or transforms are required, which keeps examples minimal

### 2.3 Create and Draw Targets

```javascript
createTarget() {
    const x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
    const y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);

    this._screen.targets.push({ x, y });
},

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
        } else {
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
```

Add some targets in `startScreen`:

```javascript
for (let i = 0; i < 5; i++) {
    this.createTarget();
}
```

**What's happening:**
- Targets spawn at random positions within the canvas bounds
- We use the target image if loaded, otherwise draw a circle
- Each target stores just x and y coordinates

### 2.4 Draw Everything Each Frame

```javascript
updateScreen(delta, time, context) {
    if (!this._screen) return;

    this.resizeCanvas();

    const ctx = this._screen.ctx;

    // Clear and set white background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._screen.canvas.width, this._screen.canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, this._screen.width, this._screen.height);

    // Draw targets
    this.drawTargets(ctx);
},
```

**What's happening:**
- We check the canvas hasn't changed size (resizeCanvas handles it)
- We reset transforms to clear the whole buffer
- We restore the DPR transform before drawing
- We draw a white background then the targets

**Test it:** The screen should now show 5 targets with the target image or red/white circles!

---

## Step 3: Connecting VR Shots to Screen

Now let's make the VR spheres communicate with the screen when they hit.

### 3.1 Send a Message When Sphere Arrives

In `updateSpheres`, replace the console.log with a message:

```javascript
if (t >= 1) {
    this._vr.sendMessage({
        event: 'SHOT',
        canvasX: sphere.canvasX,
        canvasY: sphere.canvasY,
        player: sphere.playerId
    });

    // ... dispose code ...
}
```

**What's happening:**
- `sendGameMessage` sends a custom game event to all clients
- We send the canvas coordinates where the shot hit
- We include the player ID so we can track who made the shot

### 3.2 Receive Messages on Screen

```javascript
onMessage(msg) {
    if (!this._screen) return;

    const message = msg.type === 'GAME_EVENT' ? msg.message : msg;

    if (message.event === 'SHOT') {
        console.log('Shot received:', message.canvasX, message.canvasY, message.player);
    }
},
```

**What's happening:**
- Messages come wrapped in a `GAME_EVENT` type
- We extract the actual message payload
- We check for our custom 'SHOT' event

**Test it:** Pull the trigger in VR and watch the console on the screen client. You should see shot messages logged!

---

## Step 4: Hit Detection and Scoring

Let's detect when shots hit targets and keep score.

### 4.1 Initialize Scoring System

In `startScreen`, add:

```javascript
this._screen.scores = {};
```

### 4.2 Register Shots and Check for Hits

```javascript
registerShot(x, y, playerId) {
    // Check for target hits
    for (const target of this._screen.targets) {
        const dx = x - target.x;
        const dy = y - target.y;
        const distanceSquared = dx * dx + dy * dy;
        const radiusSquared = this._screen.targetRadius * this._screen.targetRadius;

        if (distanceSquared <= radiusSquared) {
            this._screen.scores[playerId] = (this._screen.scores[playerId] || 0) + 1;
            this.repositionTarget(target);
            console.log(`${playerId} scored! Total: ${this._screen.scores[playerId]}`);
            break;
        }
    }
},

repositionTarget(target) {
    target.x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
    target.y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);
},
```

Update `onMessage`:

```javascript
if (message.event === 'SHOT') {
    this.registerShot(message.canvasX, message.canvasY, message.player);
}
```

**What's happening:**
- We use distance-squared for performance (no sqrt needed)
- When a shot hits, we increment the player's score
- The target immediately moves to a new random position
- We break after the first hit (one shot can't hit multiple targets)

**Test it:** Shoot targets in VR. When you hit one, it should move to a new position and the console should show your score!

---

## Step 5: Visual Polish

Let's add shot impact effects and a leaderboard.

### 5.1 Shot Visual Effects

Initialize in `startScreen`:

```javascript
const SHOT_FADE_TIME = 0.6;

this._screen.shotVisuals = [];
```

Add visual when shot is registered:

```javascript
registerShot(x, y, playerId) {
    // Add visual effect
    this._screen.shotVisuals.push({
        x: x,
        y: y,
        life: SHOT_FADE_TIME
    });

    // ... hit detection code ...
},
```

Draw and update the effects:

```javascript
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
        } else {
            toRemove.push(i);
        }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
        this._screen.shotVisuals.splice(toRemove[i], 1);
    }
},
```

Call it from `updateScreen`:

```javascript
this.drawShots(ctx, delta);
```

**What's happening:**
- Each shot creates a yellow circle that fades over 0.6 seconds
- Alpha decreases as life decreases
- We clean up expired effects from the array

### 5.2 Leaderboard

```javascript
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
```

Call it from `updateScreen`:

```javascript
this.drawLeaderboard(ctx);
```

**What's happening:**
- We convert scores object to an array and sort by score
- We draw from bottom-up so the title is always visible
- `ctx.save()` and `ctx.restore()` preserve canvas state

### 5.3 Moving Targets

Make targets more challenging by moving them randomly:

In `startScreen`:

```javascript
this._screen.teleportInterval = setInterval(() => {
    const randomIndex = Math.floor(Math.random() * this._screen.targets.length);
    this.repositionTarget(this._screen.targets[randomIndex]);
}, 1500 + Math.floor(Math.random() * 1500));
```

**What's happening:**
- Every 1.5-3 seconds, a random target moves
- This keeps the game dynamic and challenging

### 5.4 Bonus: Mouse Support for Testing

Let screen players test by clicking:

In `startScreen`:

```javascript
this._screen.canvas.addEventListener('click', (e) => {
    const rect = this._screen.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    this.registerShot(clickX, clickY, 'local');
});
```

**What's happening:**
- We convert mouse click position to canvas coordinates
- We register it as a shot from a 'local' player
- This lets you test without VR hardware

---

## Complete Game

Congratulations! You've built a complete VR target shooting game. Your final [game.js](src/game.js) should now match the complete implementation.

## Key Concepts Recap

1. **VR Side:**
   - Use `context.controllers` to access controller state
   - Use `getButtonDown()` for one-time button press detection
   - `context.screenState` provides ray intersection with the screen
   - THREE.js objects need proper disposal to prevent memory leaks

2. **Screen Side:**
   - Canvas requires DPI scaling for sharp rendering
   - 2D context is used for all drawing
   - Call `resizeCanvas()` each frame to handle window resizing

3. **Communication:**
   - Use `sendGameMessage()` to send custom events
   - Handle messages in `onMessage()`
   - Messages arrive on both VR and screen clients

4. **Game Design:**
   - Keep state separate (`this._vr` and `this._screen`)
   - Use arrays to track dynamic objects (spheres, targets, visuals)
   - Dispose of objects when no longer needed
   - Test with both VR and mouse input

## Next Steps

Try modifying the game to learn more:

- **Different weapons:** Add a laser mode that instant-hits
- **Power-ups:** Spawn special targets worth more points
- **Multiplayer:** Show other players' shots in different colors
- **Sound effects:** Add audio when targets are hit
- **Particle effects:** Spawn particles when targets explode
- **Difficulty modes:** Smaller targets or moving targets
- **Timer:** Add a game duration with a final winner

Refer to [README.md](README.md) for the complete API documentation.

Happy coding! 🎯
