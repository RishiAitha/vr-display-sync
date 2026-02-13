# VR Display Sync

## TL;DR
- This is a system to connect virtual reality headsets to an external screen via WebSockets and web routes.
- This strategy can be used to make interactive experiences combining XR experiences with viewable displays, helping bring isolated visualizations out into the real world.

## Resources
- Check [WebXR First Steps](https://developers.meta.com/horizon/documentation/web/webxr-first-steps/) for a great beginner WebXR guide. 

## Game API (developing with `src/game.js`)
### Purpose
- Use `game.js` to develop games or other experiences that take advantage of the combined system.
- The `game.js` file runs on every connected client, but different API methods will be called based on which client type is running the file.
- More specifically, the VR clients will run `startVR` and `updateVR`, while the screen client runs `startScreen` and `updateScreen`.
    - Both client types can send out broadcasts with `sendGameMessage` and recieve messages (although some default ones are only sent to certain client types) with `onMessage`.
- The "screen" refers to the single display client that shows a JavaScript canvas for interaction.
- The "vr" client refers to any number of clients connected in the WebXR page.

### Game loop methods
- `startVR(context)`
	- StartVR is called once after screen calibration is complete.
	- `context`: `{ scene, camera, renderer, player, controllers, sendGameMessage, screenState, screenMeta, screenRect }`
        - scene: THREE.js scene for WebXR
        - camera: THREE.js PerspectiveCamera
        - renderer: THREE.js WebGlRenderer
        - player: group containing camera and controller spaces
        - controllers: dictionary of left and right controllers, each holding respective raySpace, gripSpace, and gamepad (GamepadWrapper)
        - sendGameMessage: method to send message packets with type GAME_EVENT for additional shared game logic

- `updateVR(delta, time, context)`
	- Runs every frame
    - Delta and time in seconds (delta is time from last frame, time is total time passed)
	- `context` contains the same fields as `startVR` with additional fields:
        - screenState: holds raycast intersection status and position for left and right controllers and screen
            - if onScreen is true, sends canvasX, canvasY, hitPoint (WebXR coords), and uv of intersection
        - screenMeta: width, height, corner positions, screen rectangle scaling
        - screenRect: THREE.Mesh representing calibrated screen rectangle

- `startScreen(context)`
	- Called once on the Screen client. `context` contains `{ canvas, sendGameMessage }` and should be used to set up drawing and event handlers

- `updateScreen(delta, time, context)`
	- Runs every frame for screen canvas updates
    - Useful for animation, events, gameplay changes, and anything else happening on the screen canvas

### Messaging helpers
- `sendGameMessage(payload)`
    - Sends any message payload to all connected clients with message.type being "GAME_EVENT" and payload being message.message (actual message content)

- `onMessage(msg)` — incoming message handler.
	- Some default messages are included for ease of use:
    - Check game.js to see some uses of these broadcasts.
		- `VR_CONTROLLER_STATE` — broadcasted every frame from VR clients to screen client after calibration.
            - `controllerType`: if controller is 'left' or 'right'
            - `onScreen`: bool true if raycast is currently intersecting
            - `canvasX`/`canvasY`: pixel coords of raycast when `onScreen`
            - `position`: xyz of controller
            - `quaternion`: rotation of controller
            - `topLeftCorner`: xyz of corner of calibrated screen rectangle display
            - `bottomRightCorner`: opposite of topLeftCorner
            - `rectXDistance`: horizontal distance across calibrated screen rect (useful for weird angular projections)
            - `rectYDistance`: vertical height of rect
            - `triggerButtonState`: decimal trigger button state
            - `squeezeButtonState`: decimal grab button state
            - `button1State`: A button on Quest
            - `button2State`: B button on Quest
            - `thumbstickX`: thumbstick X position
            - `thumbstickY`: thumbstick Y position
            - `userID`: VR client user ID (great for scores or other info)
		- `SCREEN_CALIBRATION`: screen reports sizes to VR for calibration -- probably not useful as games begin after calibration finishes
		- `CALIBRATION_COMMIT`: VR sends commit to screen when user saves calibration.
		- `GAME_EVENT`: arbitrary game-level events emitted via `sendGameMessage` (you create these!)
		- `NEW_CLIENT` / `CLIENT_DISCONNECTED`: notifications about other clients.

## File Reference
- `src/vr.js`
	- Handles WebXR session setup, screen calibration, basic raycast calculations, and other VR-side setup.

- `src/screen.js`
	- Manages the browser screen-side client: canvas creation, receiving VR state messages, and sending calibration and game messages back to the host.

- `src/clientManager.js`
	- Networking layer to register clients, send/receive messages, and route events between VR, screen, and server.

- `server.js`
	- Host server that relays messages between clients and coordinates registration.
    - Run `npm run dev` to test dev server on `localhost:3000`, or `npm run build` to set up production build with webpack (useful for hosting) -- `npm run start` begins node server.
    - Reference WebXR First Steps for port forwarding for easy dev testing.

- `src/init.js`
	- Common XR + Three.js initialization for the VR client.
    - Taken from WebXR First Steps.

- `src/desktop.js`
	- Fallback desktop UI and debug view when WebXR is not available.

- `src/gameAPI.js`
	- API setup to connect game.js methods with relevant calls in `vr.js`, `screen.js`, and `client.js`.

## Credits
- Made by and for the [GTXR](https://www.gtxr.club/) club.
- Used resources and info from WebXR First Steps.