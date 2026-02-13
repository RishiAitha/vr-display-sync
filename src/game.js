/*
    Game template
*/

export default {
    // Instance variables here

    // VR handling
    // Use context.sendGameMessage(payload) to emit game events.

    // VR-side initialization hook.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage }
    async startVR(context) {
        // Called once on VR client after scene + calibration are ready.
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage,
    //            screenState, screenMeta, screenRect }
    // - `screenState`: object with `right` and `left` entries, each `{ onScreen, canvasX, canvasY, uv, hitPoint }` (per-frame intersection)
    //      - if onScreen is false, nothing else is sent; canvasX and canvasY are canvas coords, hitPoint is WebXR coords, uv is 2D coords on rect.
    // - `screenMeta`: metadata snapshot `{ screenWidth, screenHeight, topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance }`
    // - `screenRect`: the THREE.Mesh used to represent the screen rect (optional)
    updateVR(delta, time, context) {
        // Optional per-frame VR logic
    },

    // Screen handling
    // Use context.canvas to draw, context.sendGameMessage to emit events.

    // Screen-side initialization.
    // context: { canvas, sendGameMessage }
    async startScreen(context) {
        // Called once on Screen after registration and canvas creation.
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