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
            - raySpace: controller ray origin/direction pose (position, quaternion)
            - gripSpace: controller grip pose for physical position (position, quaternion)
            - gamepad: GamepadWrapper with methods getButton(XR_BUTTONS.TRIGGER), getButtonDown(), getButtonUp(), getAxis(XR_AXES.THUMBSTICK_X)
        - sendGameMessage: method to send message packets with type GAME_EVENT for additional shared game logic

- `updateVR(delta, time, context)`
	- Runs every frame
    - Delta and time in seconds (delta is time from last frame, time is total time passed)
	- `context` contains the same fields as `startVR` with additional fields:
        - controllers: access controller input here (NOT through messages)
            - Buttons: `controllers.right.gamepad.getButton(XR_BUTTONS.TRIGGER)` returns 0-1 value
            - Button events: `getButtonDown()` for press, `getButtonUp()` for release (detects edges)
            - Axes: `controllers.right.gamepad.getAxis(XR_AXES.THUMBSTICK_X)` returns -1 to 1
            - Position: `controllers.right.gripSpace.position` (THREE.Vector3)
            - Rotation: `controllers.right.gripSpace.quaternion` (THREE.Quaternion)
        - screenState: holds raycast intersection status and position for left and right controllers and screen
            - `screenState.right` and `screenState.left` contain:
                - onScreen: boolean, true if controller ray intersects screen
                - canvasX, canvasY: pixel coordinates on screen canvas (only when onScreen is true)
                - hitPoint: THREE.Vector3 world position of intersection in WebXR space
                - uv: object with x, y properties (0-1 normalized coordinates on screen rect)
        - screenMeta: width, height, corner positions, screen rectangle scaling
            - screenWidth, screenHeight: canvas dimensions in pixels
            - topLeftCorner: [x, y, z] array of screen top-left corner in WebXR world coordinates
            - bottomRightCorner: [x, y, z] array of screen bottom-right corner in WebXR world coordinates
            - rectXDistance: physical horizontal width of screen rectangle in meters
            - rectYDistance: physical vertical height of screen rectangle in meters
        - screenRect: THREE.Mesh representing calibrated screen rectangle (useful for custom raycasting if needed)

- `startScreen(context)`
	- Called once on the Screen client. `context` contains `{ canvas, sendGameMessage }` and should be used to set up drawing and event handlers

- `updateScreen(delta, time, context)`
	- Runs every frame for screen canvas updates
    - Useful for animation, events, gameplay changes, and anything else happening on the screen canvas
    - Note: Screen client does NOT have access to VR controller data in context - use GAME_EVENT messages via sendGameMessage to communicate from VR to screen

### Messaging helpers
- `sendGameMessage(payload)`
    - Sends any message payload to all connected clients with message.type being "GAME_EVENT" and payload being message.message (actual message content)
    - Used for CUSTOM game events to communicate between VR and screen clients
    - VR controller input is accessed via context.controllers in updateVR, not sent as messages
    - Example: `sendGameMessage({ event: 'SHOT', x: 100, y: 200, playerId: 'abc' })`

- `onMessage(msg)` — incoming message handler.
	- System messages (handled automatically by framework):
		- `SCREEN_CALIBRATION`: screen reports sizes to VR for calibration -- probably not useful as games begin after calibration finishes
		- `CALIBRATION_COMMIT`: VR sends commit to screen when user saves calibration.
		- `NEW_CLIENT` / `CLIENT_DISCONNECTED`: notifications about other clients connecting/disconnecting
            - msg.message contains: `{ type: 'VR' or 'SCREEN', userID: 'uuid-string' }`
	- Game messages (created by you):
		- `GAME_EVENT`: arbitrary game-level events emitted via `sendGameMessage` (you create these!)
            - Example handling: `if (msg.type === 'GAME_EVENT' && msg.message.event === 'SHOT') { handleShot(msg.message.x, msg.message.y); }`

## File Reference
- `src/vr.js`
	- Handles WebXR session setup, screen calibration, basic raycast calculations, and other VR-side setup.

- `src/screen.js`
	- Manages the browser screen-side client: canvas creation, sending calibration messages, and handling GAME_EVENT messages.

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