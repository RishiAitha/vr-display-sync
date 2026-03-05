# Building Your First WebXR Game: Target Shooter Tutorial

This tutorial uses a simple target shooting game to cover how to handle VR controllers, draw on a screen canvas, communicate between VR and screen clients, and implement game logic using the new **games system**.

## Overview

- VR players shoot spheres by pulling the trigger (or pinching fingers with hand tracking)
- Spheres fly in the direction the controller/hand is pointing
- Only spheres that hit the screen are checked for target collisions
- The screen displays targets that move randomly
- Players score points by hitting targets
- A leaderboard tracks all players' scores

---

## Step 1: Create the Game Structure

First, let's create the game file with metadata for settings.

### 1.1 Create tutorialGame.js

Create a new file `src/games/tutorialGame.js` with the basic structure (delete the existing file if necessary):

```javascript
import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

export const metadata = {
    id: 'tutorial',
    name: 'Tutorial Shooter',
    description: 'Simple target shooting game from the tutorial',
    settings: [
        {
            key: 'sphereSpeed',
            label: 'Sphere Speed',
            type: 'number',
            default: 3.0,
            min: 1.0,
            max: 10.0,
            step: 0.5,
            tab: 'tutorial',
            applyTo: 'vr',
            description: 'Speed of projectile spheres (meters per second)'
        },
        {
            key: 'sphereColor',
            label: 'Sphere Color',
            type: 'color',
            default: '#ffee66',
            tab: 'tutorial',
            description: 'Color of projectile spheres'
        },
        {
            key: 'targetCount',
            label: 'Target Count',
            type: 'number',
            default: 5,
            min: 1,
            max: 20,
            step: 1,
            tab: 'tutorial',
            applyTo: 'screen',
            description: 'Number of targets on screen'
        }
    ]
};

const SPHERE_RADIUS = 0.02;
const SHOT_FADE_TIME = 0.6;
const TARGET_RADIUS_PERCENT = 0.06;

export default {
    // VR state
    _vr: null,
    
    // Screen state
    _screen: null,

    // VR lifecycle
    async startVR(context) {
        // We'll fill this in next
    },

    updateVR(delta, time, context) {
        // We'll fill this in next
    },

    disposeVR(context) {
        // Clean up VR resources
        if (this._vr && this._vr.activeSpheres) {
            this._vr.activeSpheres.forEach(sphere => {
                if (sphere.mesh && sphere.mesh.parent) {
                    sphere.mesh.parent.remove(sphere.mesh);
                }
                if (sphere.mesh && sphere.mesh.geometry) {
                    sphere.mesh.geometry.dispose();
                }
            });
        }
        if (this._vr && this._vr.sphereMaterial) {
            this._vr.sphereMaterial.dispose();
        }
        this._vr = null;
    },

    // Screen lifecycle
    async startScreen(context) {
        // We'll fill this in next
    },

    updateScreen(delta, time, context) {
        // We'll fill this in next
    },

    disposeScreen(context) {
        // Clean up screen resources
        if (this._screen && this._screen.teleportInterval) {
            clearInterval(this._screen.teleportInterval);
        }
        this._screen = null;
    },

    // Message handler
    onMessage(msg) {
        // We'll fill this in next
    }
};
```

**What's happening:**
- We export `metadata` with our game's settings schema
- Settings include sphere speed, color, and target count
- The game object has all required lifecycle methods
- We initialize state variables to null (filled in on start)

### 1.2 Register the Game

Add the game to `src/games/index.js`:

```javascript
import tutorialGame, { metadata as tutorialMetadata } from './tutorialGame.js';

export const GAMES = new Map([
    ['balls', { game: ballsGame, metadata: ballsMetadata }],
    ['paint', { game: paintGame, metadata: paintMetadata }],
    ['draw', { game: drawGame, metadata: drawMetadata }],
    ['tutorial', { game: tutorialGame, metadata: tutorialMetadata }]  // Add this line
]);
```

### 1.3 Add Default Settings

Add to `config/defaults.json`:

```json
{
  "gameDefaults": {
    "tutorial": {
      "sphereSpeed": 3.0,
      "sphereColor": "#ffee66",
      "targetCount": 5
    }
  }
}
```

### 1.4 Add to Game Selector

In `src/defaultSettings.js`, update the options array:

```javascript
options: ['balls', 'paint', 'draw', 'tutorial']  // Add 'tutorial'
```

---

## Step 2: Shooting Spheres from VR Controllers

## Step 2: Shooting Spheres from VR Controllers

Let's make VR controllers spawn and shoot spheres in any direction.

### 2.1 Set Up VR Initialization

Fill in the `startVR` method:

```javascript
async startVR(context) {
    const { settings } = context;
    
    // Generate a unique player ID
    const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
    
    // Parse color from settings
    const colorInt = parseInt(settings.sphereColor.replace('#', ''), 16);
    
    this._vr = {
        activeSpheres: [],
        sphereMaterial: new THREE.MeshBasicMaterial({ color: colorInt }),
        playerId: playerId,
        sendMessage: context.sendGameMessage
    };
    
    console.log('Tutorial game VR started for player:', playerId);
}
```

**What's happening:**
- We access settings via `context.settings`
- `sphereColor` comes from metadata, can be changed in settings UI
- We create a reusable material with the configured color
- Each player gets a unique ID for scoring

### 2.2 Detect Trigger Presses

Fill in the `updateVR` method to detect when the player shoots:

```javascript
updateVR(delta, time, context) {
    if (!this._vr) return;
    
    const { controllers, settings, scene } = context;
    const sides = ['right', 'left'];
    
    // Check both controllers for trigger press
    sides.forEach(side => {
        const controller = controllers[side];
        if (!controller || !controller.gamepad) return;
        
        // Check if trigger was just pressed (works with hand tracking pinch too)
        if (controller.gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
            this.spawnSphere(controller, context);
        }
    });
    
    // Update all active spheres
    this.updateSpheres(delta, context);
}
```

**What's happening:**
- `getButtonDown()` returns true only on the frame the trigger is pressed
- Works automatically with hand tracking (pinch gesture = trigger)
- We check both left and right controllers
- Spheres spawn regardless of whether we're pointing at the screen

### 2.3 Spawn Spheres

Add the sphere spawning function:

```javascript
spawnSphere(controller, context) {
    if (!controller.raySpace) return;
    
    const { scene, settings } = context;
    
    // Create sphere at controller position
    const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 16, 12);
    const mesh = new THREE.Mesh(geometry, this._vr.sphereMaterial);
    
    const startPosition = controller.raySpace.position.clone();
    mesh.position.copy(startPosition);
    scene.add(mesh);
    
    // Get direction from controller's forward vector
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(controller.raySpace.quaternion);
    direction.normalize();
    
    // Store sphere data
    this._vr.activeSpheres.push({
        mesh: mesh,
        direction: direction,
        speed: settings.sphereSpeed,
        startPosition: startPosition.clone(),
        hasHitScreen: false
    });
}
```

**What's happening:**
- Sphere spawns at controller's ray position
- Direction is calculated from controller's forward vector (0, 0, -1 rotated by quaternion)
- We store speed from settings (configurable in UI)
- `hasHitScreen` tracks if this sphere has checked for screen hits yet

### 2.4 Animate Spheres and Detect Screen Hits

Add sphere update logic:

```javascript
updateSpheres(delta, context) {
    if (!this._vr) return;
    
    const { screenRect, screenMeta, scene } = context;
    const toRemove = [];
    
    // Create raycaster for screen collision detection
    const raycaster = new THREE.Raycaster();
    
    this._vr.activeSpheres.forEach((sphere, index) => {
        // Move sphere in its direction
        const movement = sphere.direction.clone().multiplyScalar(sphere.speed * delta);
        sphere.mesh.position.add(movement);
        
        // Check if sphere traveled too far (10 meters)
        const distance = sphere.mesh.position.distanceTo(sphere.startPosition);
        if (distance > 10) {
            toRemove.push(index);
            return;
        }
        
        // Check for screen intersection (only once per sphere)
        if (!sphere.hasHitScreen && screenRect) {
            // Cast ray from sphere in its movement direction
            raycaster.set(sphere.mesh.position, sphere.direction);
            const intersects = raycaster.intersectObject(screenRect, false);
            
            if (intersects.length > 0 && intersects[0].distance < SPHERE_RADIUS * 2) {
                sphere.hasHitScreen = true;
                
                // Calculate canvas coordinates from UV
                const uv = intersects[0].uv;
                if (uv && screenMeta) {
                    const canvasX = Math.round(uv.x * screenMeta.screenWidth);
                    const canvasY = Math.round((1 - uv.y) * screenMeta.screenHeight);
                    
                    // Send shot message to screen
                    this._vr.sendMessage({
                        event: 'SHOT',
                        canvasX: canvasX,
                        canvasY: canvasY,
                        player: this._vr.playerId
                    });
                    
                    // Remove sphere after hit
                    toRemove.push(index);
                    console.log('Hit screen at:', canvasX, canvasY);
                }
            }
        }
    });
    
    // Remove spheres (from back to avoid index issues)
    for (let i = toRemove.length - 1; i >= 0; i--) {
        const sphere = this._vr.activeSpheres[toRemove[i]];
        scene.remove(sphere.mesh);
        sphere.mesh.geometry.dispose();
        this._vr.activeSpheres.splice(toRemove[i], 1);
    }
}
```

**What's happening:**
- Spheres move continuously in their spawn direction
- We use raycasting to detect when a sphere intersects the screen mesh
- UV coordinates are converted to canvas pixel coordinates
- Only screen hits send the SHOT message (other shots are ignored)
- Spheres are removed after traveling 10 meters or hitting the screen

**Test it:** Select "Tutorial Shooter" in the settings, enter VR, and pull the trigger. Yellow spheres should fly in the direction you're pointing. When they hit the screen, you should see console logs!

---
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

**Some more details about screenState:**
- `screenState` is an object sent with varying information based on availability
- `screenState.onScreen` is true if the controller ray is hitting the screen
- if `onScreen` is true, then other information is sent (check README for info)
    - otherwise, only that false value is sent, as other info isn't available

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

## Step 3: Drawing Targets on the Screen

Now let's set up the screen client to display targets that players can shoot.

### 3.1 Initialize the Screen Canvas

Fill in the `startScreen` method:

```javascript
async startScreen(context) {
    const { canvas, settings, sendGameMessage } = context;
    
    this._screen = {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        width: 0,
        height: 0,
        targetRadius: 0,
        targets: [],
        scores: {},
        shotVisuals: [],
        sendMessage: sendGameMessage,
        targetImage: new Image()
    };
    
    this.resizeCanvas();
    
    // Create targets based on settings
    for (let i = 0; i < settings.targetCount; i++) {
        this.createTarget();
    }
    
    // Make random target move every 1.5-3 seconds
    this._screen.teleportInterval = setInterval(() => {
        if (this._screen.targets.length > 0) {
            const randomIndex = Math.floor(Math.random() * this._screen.targets.length);
            this.repositionTarget(this._screen.targets[randomIndex]);
        }
    }, 1500 + Math.floor(Math.random() * 1500));
    
    // Load target image
    this._screen.targetImage.src = 'assets/target.png';
    
    console.log('Tutorial game screen started with', settings.targetCount, 'targets');
}
```

**What's happening:**
- We access `settings.targetCount` to determine how many targets to create
- Canvas and 2D context are stored for drawing
- Targets move randomly at intervals for challenge
- We load a target image asset

### 3.2 Handle Canvas Resizing

Add canvas resizing logic:

```javascript
resizeCanvas() {
    const canvas = this._screen.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    // Only resize if dimensions changed
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        
        this._screen.width = width;
        this._screen.height = height;
        this._screen.targetRadius = Math.min(width, height) * TARGET_RADIUS_PERCENT;
    }
}
```

**What's happening:**
- Canvas sized to match its CSS layout (1:1 pixels, no DPR scaling for simplicity)
- Target radius is percentage of canvas size
- Only resizes when dimensions actually change

### 3.3 Create and Draw Targets

Add target management functions:

```javascript
createTarget() {
    const x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
    const y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);
    this._screen.targets.push({ x, y });
},

repositionTarget(target) {
    target.x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
    target.y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);
},

drawTargets(ctx) {
    const radius = this._screen.targetRadius;
    
    this._screen.targets.forEach(target => {
        // Draw target image if loaded, otherwise draw circle
        if (this._screen.targetImage.complete && this._screen.targetImage.naturalWidth > 0) {
            ctx.drawImage(
                this._screen.targetImage,
                target.x - radius,
                target.y - radius,
                radius * 2,
                radius * 2
            );
        } else {
            // Fallback: red circle with white center
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(target.x, target.y, radius * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
    });
},
```

**What's happening:**
- Targets spawn at random positions within canvas bounds
- `repositionTarget` moves a target to a new random location
- Drawing uses loaded image or falls back to circles

### 3.4 Draw Everything Each Frame

Fill in the `updateScreen` method:

```javascript
updateScreen(delta, time, context) {
    if (!this._screen) return;
    
    this.resizeCanvas();
    
    const ctx = this._screen.ctx;
    const { width, height } = this._screen;
    
    // Clear canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    
    // Draw white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    // Draw game elements
    this.drawTargets(ctx);
    this.drawShots(ctx, delta);
    this.drawLeaderboard(ctx);
},
```

**What's happening:**
- Check for resize each frame
- Clear and reset transforms
- Draw background, targets, shot effects, and leaderboard

**Test it:** Open `/screen` in a browser. You should see red/white targets (or target images if assets loaded)!

---
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

## Step 4: Connecting VR Shots to Screen

Now let's make the screen receive and process shot messages from VR.

### 4.1 Handle Shot Messages

Fill in the `onMessage` method:

```javascript
onMessage(msg) {
    // Only process on screen client
    if (!this._screen) return;
    
    if (msg.event === 'SHOT') {
        this.registerShot(msg.canvasX, msg.canvasY, msg.player);
    }
},
```

**What's happening:**
- We check for the custom 'SHOT' event
- Extract canvas coordinates and player ID
- Pass to hit detection system

**Test it:** Run both VR and screen clients. Shoot at the screen from VR. The screen console should log shot events!

---

## Step 5: Hit Detection and Scoring

Let's detect when shots hit targets and track scores.

### 5.1 Register Shots and Check for Hits

Add the hit detection logic:

```javascript
registerShot(x, y, playerId) {
    // Add visual effect
    this._screen.shotVisuals.push({
        x: x,
        y: y,
        life: SHOT_FADE_TIME
    });
    
    // Check for target hits
    const hitRadius = this._screen.targetRadius;
    
    for (let i = 0; i < this._screen.targets.length; i++) {
        const target = this._screen.targets[i];
        const dx = target.x - x;
        const dy = target.y - y;
        const distanceSquared = dx * dx + dy * dy;
        
        // Check if shot is within target radius
        if (distanceSquared <= hitRadius * hitRadius) {
            // Hit! Increment score
            if (!this._screen.scores[playerId]) {
                this._screen.scores[playerId] = 0;
            }
            this._screen.scores[playerId]++;
            
            // Move target to new position
            this.repositionTarget(target);
            
            console.log('Hit! Player', playerId, 'scored. Total:', this._screen.scores[playerId]);
            break;  // Only hit one target per shot
        }
    }
},
```

**What's happening:**
- We use distance-squared for efficient circle collision detection
- When a shot hits, we increment the player's score
- Target immediately moves to a new random position
- We break after the first hit (one shot can't hit multiple targets)

**Test it:** Shoot targets from VR. When you hit one, it should move and your score should increase!

---

## Step 6: Visual Polish

Let's add shot impact effects and a leaderboard.

### 6.1 Shot Visual Effects

Add the shot drawing function:

```javascript
drawShots(ctx, delta) {
    const toRemove = [];
    
    this._screen.shotVisuals.forEach((shot, index) => {
        // Decrease life
        shot.life -= delta;
        
        if (shot.life <= 0) {
            toRemove.push(index);
            return;
        }
        
        // Draw fading circle
        const alpha = shot.life / SHOT_FADE_TIME;
        const radius = 10 + (1 - alpha) * 10;  // Expands as it fades
        
        ctx.fillStyle = `rgba(255, 238, 102, ${alpha})`;
        ctx.beginPath();
        ctx.arc(shot.x, shot.y, radius, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Remove expired effects (from back to avoid index shifts)
    for (let i = toRemove.length - 1; i >= 0; i--) {
        this._screen.shotVisuals.splice(toRemove[i], 1);
    }
},
```

**What's happening:**
- Each shot creates a yellow circle that fades over 0.6 seconds
- Circle expands as it fades for nice visual effect
- Alpha channel decreases as life decreases
- Expired effects are cleaned up from the array

### 6.2 Leaderboard

Add leaderboard rendering:

```javascript
drawLeaderboard(ctx) {
    ctx.save();
    
    // Convert scores to sorted array
    const entries = Object.entries(this._screen.scores)
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score);  // Highest first
    
    if (entries.length === 0) return;
    
    // Draw background
    const padding = 20;
    const lineHeight = 30;
    const width = 250;
    const height = padding * 2 + lineHeight * (entries.length + 1);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(this._screen.width - width - padding, padding, width, height);
    
    // Draw title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('LEADERBOARD', this._screen.width - width, padding + 25);
    
    // Draw scores
    ctx.font = '16px monospace';
    entries.forEach((entry, index) => {
        const y = padding + 25 + lineHeight * (index + 1);
        const shortId = entry.id.substring(0, 12);  // Truncate long IDs
        ctx.fillText(`${shortId}: ${entry.score}`, this._screen.width - width + padding, y);
    });
    
    ctx.restore();
},
```

**What's happening:**
- Scores converted to array and sorted by score (highest first)
- Dark semi-transparent background for readability
- Player IDs are truncated to fit nicely
- Positioned in top-right corner

**Test it:** Play the game! You should see yellow impact flashes when you shoot, and a leaderboard tracking scores in the top-right!

---

## Complete!

You've built a complete multi-player VR game! Key concepts covered:

- **Game structure**: Metadata + lifecycle methods
- **Settings system**: Configurable values via UI
- **VR input**: Controller triggers (and hand tracking pinch)
- **3D shooting**: Raycasting for screen intersection
- **VR→Screen communication**: `sendGameMessage` for custom events
- **2D canvas rendering**: Targets, effects, and UI
- **Hit detection**: Distance-based collision
- **State management**: Scores, visuals, and cleanup

### Next Steps:

- Add sound effects when shooting and hitting targets
- Create different target types with different point values
- Add powerups that give temporary bonuses
- Implement a timer and game over screen
- Add particle effects in VR when spheres hit the screen
- Try using hand tracking gestures for special abilities

### Testing Your Game:

1. Build: `npm run build`
2. Start server: `npm start` (or `npm run dev:https` for Quest)
3. Open settings at `/settings` and select "Tutorial Shooter"
4. Open screen at `/screen`
5. Open VR at `/vr` on your Quest
6. Calibrate the screen, then start shooting!

Enjoy your game!

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
    if (!this._screen) {
        return;
    }

    if (msg.event === 'SHOT') {
        this.registerShot(msg.canvasX, msg.canvasY, msg.player);
    }
},
```

**What's happening:**
- We check for our custom 'SHOT' event
- We send that shot's information to be registered

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
if (msg.event === 'SHOT') {
    this.registerShot(msg.canvasX, msg.canvasY, msg.player);
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

## Testing Locally

Run commands:
- npm install
    - installs relevant libraries for site
- npm run dev
    - runs dev server for site

Set up port forwarding:
- open chrome and go to chrome://inspect
- under "Port Forwarding", add a new rule for localhost:3000
    - the number should be set as 3000, and the url would be localhost:3000
- plug in your VR headset
    - a notification will appear to allow usb debugging, click on it to allow
    - you should see the device appear in the chrome inspect tab
    - a green circle with 3000 should appear

Opening correct pages:
- on VR, open localhost:3000/vr
    - ensure that the port forwarding page is open and maximized when opening on VR
- for the screen, head to localhost:3000/screen (on the device running the dev server)

## Complete Game

Congratulations! You've built a complete VR target shooting game. Your final [game.js](src/game.js) should now match the complete implementation.

Refer to [README.md](README.md) for the complete API documentation.
