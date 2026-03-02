import * as cm from './clientManager.js';

// Game glue: register multiple games and switch between them at runtime.
const games = new Map();
let activeGameId = null;
let currentGame = null;

export function registerGame(id, game) {
    if (!id) return;
    games.set(String(id), game || null);
    if (!activeGameId) {
        setActiveGame(String(id));
    }
}

export function registerGames(entries) {
    if (!entries) return;
    for (const [id, game] of Object.entries(entries)) {
        registerGame(id, game);
    }
}

export function getActiveGameId() {
    return activeGameId;
}

export function setActiveGame(id, { vrContext = null, screenContext = null } = {}) {
    const nextId = String(id);
    if (activeGameId === nextId && currentGame) return;

    const prev = currentGame;
    if (prev) {
        if (vrContext && typeof prev.disposeVR === 'function') {
            try { prev.disposeVR(vrContext); } catch (e) { console.error('game disposeVR error', e); }
        }
        if (screenContext && typeof prev.disposeScreen === 'function') {
            try { prev.disposeScreen(screenContext); } catch (e) { console.error('game disposeScreen error', e); }
        }
    }

    activeGameId = nextId;
    currentGame = games.get(nextId) || null;
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

export async function startScreen(ctx) {
    if (currentGame && typeof currentGame.startScreen === 'function') {
        try { await currentGame.startScreen(ctx); } catch (e) { console.error('game startScreen error', e); }
    }
}

export function updateScreen(delta, time, ctx) {
    if (currentGame && typeof currentGame.updateScreen === 'function') {
        try { currentGame.updateScreen(delta, time, ctx); } catch (e) { console.error('game updateScreen error', e); }
    }
}

// Forward incoming GAME_EVENT messages from the network to this API
cm.handleEvent('GAME_EVENT', (msg) => {
    onMessage(msg);
});

// Auto-load a default no-op game if none is registered to avoid checks elsewhere
registerGame('noop', {
    startVR: async () => {},
    updateVR: () => {},
    startScreen: async () => {},
    updateScreen: () => {},
    onMessage: () => {},
    disposeVR: () => {},
    disposeScreen: () => {}
});

export default {
    registerGame,
    registerGames,
    setActiveGame,
    getActiveGameId,
    sendGameMessage,
    onMessage,
    startVR,
    updateVR,
    startScreen,
    updateScreen
};
