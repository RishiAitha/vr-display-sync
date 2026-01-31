import * as cm from './clientManager.js';

// Minimal game glue: register a single active game implementation
let currentGame = null;

export function registerGame(game) {
    currentGame = game || null;
}

export function sendGameMessage(payload) {
    cm.sendGameMessage(payload);
}

export function onMessage(message) {
    if (currentGame && typeof currentGame.onMessage === 'function') {
        try { currentGame.onMessage(message); } catch (e) { console.error('game onMessage error', e); }
    }
}

export async function startVR(ctx) {
    if (currentGame && typeof currentGame.startVR === 'function') {
        try { await currentGame.startVR(ctx); } catch (e) { console.error('game startVR error', e); }
    }
}

export function updateVR(delta, time, ctx) {
    if (currentGame && typeof currentGame.updateVR === 'function') {
        try { currentGame.updateVR(delta, time, ctx); } catch (e) { console.error('game updateVR error', e); }
    }
}

export async function startWall(ctx) {
    if (currentGame && typeof currentGame.startWall === 'function') {
        try { await currentGame.startWall(ctx); } catch (e) { console.error('game startWall error', e); }
    }
}

export function updateWall(delta, time, ctx) {
    if (currentGame && typeof currentGame.updateWall === 'function') {
        try { currentGame.updateWall(delta, time, ctx); } catch (e) { console.error('game updateWall error', e); }
    }
}

// Forward incoming GAME_EVENT messages from the network to this API
cm.handleEvent('GAME_EVENT', (msg) => {
    onMessage(msg);
});

// Auto-load a default no-op game if none is registered to avoid checks elsewhere
registerGame({
    startVR: async () => {},
    updateVR: () => {},
    startWall: async () => {},
    updateWall: () => {},
    onMessage: () => {}
});

export default {
    registerGame,
    sendGameMessage,
    onMessage,
    startVR,
    updateVR,
    startWall,
    updateWall
};
