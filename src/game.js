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


    // VR-side initialization hook. context: { scene, camera, renderer, player, controllers, sendGameMessage }
    async startVR(context) {
        // Called once on VR client after scene + calibration are ready.
        // Use context.sendGameMessage(payload) to emit game events.
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    updateVR(delta, time, context) {
        // Optional per-frame VR logic
    },

    // Screen-side initialization. context: { canvas, sendGameMessage }
    async startScreen(context) {
        // Called once on Screen after registration and canvas creation.
        // Use context.canvas to draw, context.sendGameMessage to emit events.
    },

    // Optional per-frame Screen update. delta,time in seconds.
    updateScreen(delta, time, context) {
        // Optional per-frame screen logic
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
            // state.canvasX / state.canvasY are pixel coords on the screen canvas
            // Example: detect trigger press
            const trigger = state.triggerButtonState || 0;
            if (trigger > 0.5) {
                console.log('Shot at', state.canvasX, state.canvasY, 'from', state.userID);
            }
            return;
        }

        // New client connected (useful for join UI)
        if (msg.type === 'NEW_CLIENT' && msg.message) {
            const info = msg.message; // { type, userID }
            console.log('Client joined:', info.type, info.userID);
            return;
        }

        // Client disconnected (cleanup)
        if (msg.type === 'CLIENT_DISCONNECTED' && msg.message) {
            const info = msg.message; // { type, userID }
            console.log('Client left:', info.userID);
            return;
        }

        // Generic game-level payloads sent via sendGameMessage(payload)
        

        // Fallback: raw payloads
        console.log('game onMessage received', msg);
    }
};