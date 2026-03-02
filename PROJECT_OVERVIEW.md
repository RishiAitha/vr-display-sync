# VR Display Sync — Project Overview

## What this project is
VR Display Sync is a multi-client WebXR system that lets one or more headset clients interact with a single “screen client” (a 2D canvas in a normal browser window). Clients coordinate through a Node.js server using WebSockets.

Typical use case:
- A **Meta Quest** (or other WebXR device) runs the **XR client** at `/vr`.
- A laptop/TV/projector runs the **screen client** at `/screen`.
- The XR client calibrates a virtual “screen surface” in XR space, then computes controller-ray intersections with that surface and maps them to **pixel coordinates** on the screen canvas.

This enables mixed experiences:
- People in XR can “touch/point” at the real-world display.
- Spectators can see the game/visualization on the external screen.
- Both sides can exchange custom game events.

---

## High-level architecture

### Components
- **Server (`server.js`)**
  - Express static server + WebSocket relay (using `ws`).
  - Enforces that only **one Screen client** can be registered at a time.
  - Forwards calibration + game messages between clients.
  - On this branch (`RyansTestBranch`): supports **optional HTTPS** (needed for Quest/WebXR over LAN).

- **XR client (`src/vr.js`)**
  - Runs in the `/vr` page.
  - Initializes a Three.js WebXR scene (via `src/init.js`).
  - Performs **screen calibration** by letting the user move/rotate/scale a virtual screen surface using widgets.
  - Computes per-frame raycasts from XR controllers to the calibrated screen mesh.
  - Exposes intersection results to the game layer as `screenState` / `screenMeta`.

- **Screen client (`src/screen.js`)**
  - Runs in the `/screen` page.
  - Creates a full-window HTML `<canvas>`.
  - Sends its pixel dimensions to XR clients for calibration.
  - Runs a per-frame loop for game rendering.

- **Desktop fallback (`src/desktop.js`)**
  - Runs in `/desktop`.
  - Registers to the server and shows a simple “connection status” UI.
  - Useful for debugging WebSocket flow without XR.

- **Networking layer (`src/clientManager.js`)**
  - Manages WebSocket connection lifecycle and message routing.
  - Provides:
    - `registerToServer(type)`
    - `sendMessage(message)`
    - `handleEvent(type, handler)`
    - `sendGameMessage(payload)`

- **Game abstraction (`src/gameAPI.js` + `src/game.js`)**
  - `gameAPI.js` is a small wrapper that calls your game’s hooks safely.
  - `game.js` is the default “game implementation”. It runs on both XR and Screen clients, but different hooks are called depending on client type.

---

## Routes and bundles

### HTTP routes (served from `public/*.html`)
- `/` → `public/index.html` (loads `dist/index.js`)
- `/vr` → `public/vr.html` (loads `dist/vr.js`)
- `/screen` → `public/screen.html` (loads `dist/screen.js`)
- `/desktop` → `public/desktop.html` (loads `dist/desktop.js`)

### Webpack
- Entry points are defined in `webpack.config.js`:
  - `src/index.js`, `src/vr.js`, `src/screen.js`, `src/desktop.js`
- Output goes to `dist/`.

---

## How clients connect and coordinate

### Client registration
Each client opens a WebSocket to the same host/port as the page.

Client types:
- `SCREEN`
- `VR`
- `DESKTOP`

Registration message (client → server):
```json
{ "type": "REGISTER_CLIENT", "clientType": "VR" }
```

Server responses:
- `REGISTRATION_SUCCESS`
- `REGISTRATION_ERROR` (notably for a second Screen)

### Screen dimension handshake
The Screen client sends:
- `SCREEN_CALIBRATION` with `{ screenWidth, screenHeight }`

The server forwards that message to all `VR` clients.

### Calibration commit
When XR calibration is “saved”, XR sends:
- `CALIBRATION_COMMIT` with `{ topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance }`

The server forwards `CALIBRATION_COMMIT` to the `SCREEN` client.

### Game messages
For arbitrary game events, either side can send:
- `GAME_EVENT` with any payload

The server broadcasts `GAME_EVENT` to all connected clients.

---

## The “Game API” (how you build experiences)

### Where to put your gameplay logic
Edit **`src/game.js`**.

This file exports a single object with optional hooks:
- `startVR(context)`
- `updateVR(delta, time, context)`
- `startScreen(context)`
- `updateScreen(delta, time, context)`
- `onMessage(msg)`

### VR hook contexts
When VR is running:
- `startVR(context)` runs once after calibration is committed.
- `updateVR(delta, time, context)` runs every frame.

`context` includes:
- `scene`, `camera`, `renderer`, `player`
- `controllers` (left/right, with `raySpace`, `gripSpace`, and `gamepad`)
- `sendGameMessage(payload)`
- `screenState` (per-frame intersection results)
- `screenMeta` (screen + calibration metadata)
- `screenRect` (Three.js mesh for the calibrated screen)

### Screen hook contexts
On the screen client:
- `startScreen({ canvas, sendGameMessage, committedCalibration })`
- `updateScreen({ canvas, sendGameMessage })`

Important limitation:
- Screen does **not** get XR controller data directly. Communicate XR→Screen via `sendGameMessage`.

---

## Calibration: how XR maps rays → canvas pixels

### Calibration state
The XR client maintains:
- Screen pixel dimensions (`screenWidth`, `screenHeight`, `aspectRatio`)
- Two 3D corners defining the screen plane:
  - `topLeftCorner: [x, y, z]`
  - `bottomRightCorner: [x, y, z]`
- Derived physical size:
  - `rectXDistance` (width in meters)
  - `rectYDistance` (height in meters)

### Widgets
In calibration mode, XR spawns widgets you can grab/drag:
- **Translate** widgets (X/Y/Z)
- **Rotate** widget
- **Scale** widgets (top-left / bottom-right)
- **Confirm ball** (purple sphere): commit/save calibration

### Raycasting
Each frame (after calibration):
- For each controller (`left` and `right`):
  - Create a ray from `raySpace.position` along `raySpace.quaternion` forward vector
  - Intersect it against `screenRect`
  - Use the intersection `uv` to compute pixel coordinates:
    - `canvasX = uv.x * screenWidth`
    - `canvasY = (1 - uv.y) * screenHeight`

Those results are provided to gameplay code as `context.screenState`.

---

## XR mode: VR vs Mixed Reality (passthrough)

### Key idea
On Meta Quest, **passthrough** is part of **immersive AR** (`immersive-ar`) sessions.
- `immersive-vr` → fully virtual environment
- `immersive-ar` → mixed reality / passthrough (when supported and permitted)

### This branch’s intended behavior
- The `/vr` page checks for `immersive-ar` support.
- `src/init.js` creates an `ARButton`.

So the intent is to start an AR session (passthrough).

---

## Local development & testing

### Install and run
```bash
npm ci
npm run dev
```

Open locally:
- `http://localhost:3000/`
- `http://localhost:3000/screen`

### Testing on Quest over LAN (important)
WebXR on Quest requires a **secure context** for non-localhost origins.
That means:
- `http://192.168.x.x:3000` is typically not sufficient
- Use **HTTPS** or a tunnel

This branch supports HTTPS via environment variables:
- `SSL_KEY` path to private key
- `SSL_CERT` path to certificate

Example (self-signed cert; you may see a warning on Quest Browser):
```bash
mkdir -p .cert
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout .cert/key.pem \
  -out .cert/cert.pem \
  -days 365 \
  -subj "/CN=<YOUR_LAN_IP>"

SSL_KEY=.cert/key.pem SSL_CERT=.cert/cert.pem npm run dev
```

Then on Quest:
- `https://<YOUR_LAN_IP>:3000/vr`

On your laptop/display:
- `https://<YOUR_LAN_IP>:3000/screen`

### Common pitfalls
- Only **one** Screen client can be connected at once.
- If you open `/screen` twice, the second one will be rejected.
- If Quest refuses a self-signed cert, use a trusted local cert tool (e.g. `mkcert`) or a HTTPS tunnel.

---

## Key files (reference)

- `server.js`
  - Express server + WebSocket relay + optional HTTPS support.

- `src/clientManager.js`
  - Client-side WebSocket management and event dispatch.

- `src/vr.js`
  - XR scene setup, calibration, widgets, raycasting, and passing `screenState`/`screenMeta` to the game.

- `src/screen.js`
  - Screen-side canvas creation, calibration messaging, and game loop.

- `src/gameAPI.js`
  - Safe wrapper to call your game hooks.

- `src/game.js`
  - Where you implement gameplay/experience logic.

- `src/init.js`
  - Three.js/WebXR initialization and controller wiring.

---

## Recommended extension points

- **Build new experiences by editing `src/game.js`**
  - Read controller input in `updateVR`
  - Use `context.screenState` to map controller rays to screen pixels
  - Draw to the screen canvas in `updateScreen`
  - Send cross-client events via `sendGameMessage(payload)`

- **Add new system message types only when necessary**
  - Update server routing in `server.js`
  - Update client routing in `clientManager.js`

- **If you change calibration behavior**
  - Most calibration logic is inside `src/vr.js`.
  - Be careful to preserve UV mapping assumptions used to compute `canvasX/canvasY`.

---

## Suggested next steps
- Decide whether your primary mode is:
  - Mixed reality (`immersive-ar` + passthrough), or
  - VR (`immersive-vr`)
- Add a small “mode selector” so you can choose VR vs MR at runtime.
- Add calibration persistence (localStorage or server) so you don’t recalibrate every session.
