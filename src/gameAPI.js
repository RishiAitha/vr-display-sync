import * as cm from './clientManager.js';
import { GAMES } from './games/index.js';

// Game glue: register multiple games and switch between them at runtime.
const games = new Map();
let activeGameId = null;
let currentGame = null;
let currentSettings = {}; // Current settings object passed to games

// Initialize games from registry
for (const [id, { game }] of GAMES) {
    games.set(id, game);
}

export function getActiveGameId() {
    return activeGameId;
}

/**
 * Update the current settings object
 * @param {Object} newSettings - New settings to merge
 */
export function updateSettings(newSettings) {
    if (!newSettings) return;
    currentSettings = { ...currentSettings, ...newSettings };
}

/**
 * Get the current settings object
 * @returns {Object} Current settings
 */
export function getCurrentSettings() {
    return { ...currentSettings };
}

export function setActiveGame(id, { vrContext = null, screenContext = null, settings = null } = {}) {
    const nextId = String(id);
    if (activeGameId === nextId && currentGame) return;

    // Update settings if provided
    if (settings) {
        updateSettings(settings);
    }

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
        const contextWithSettings = { ...ctx, settings: currentSettings };
        try { await currentGame.startVR(contextWithSettings); } catch (e) { console.error('game startVR error', e); }
    }
}

export function updateVR(delta, time, ctx) {
    if (currentGame && typeof currentGame.updateVR === 'function') {
        const contextWithSettings = { ...ctx, settings: currentSettings };
        try { currentGame.updateVR(delta, time, contextWithSettings); } catch (e) { console.error('game updateVR error', e); }
    }
}

export async function startScreen(ctx) {
    if (currentGame && typeof currentGame.startScreen === 'function') {
        const contextWithSettings = { ...ctx, settings: currentSettings };
        try { await currentGame.startScreen(contextWithSettings); } catch (e) { console.error('game startScreen error', e); }
    }
}

export function updateScreen(delta, time, ctx) {
    if (currentGame && typeof currentGame.updateScreen === 'function') {
        const contextWithSettings = { ...ctx, settings: currentSettings };
        try { currentGame.updateScreen(delta, time, contextWithSettings); } catch (e) { console.error('game updateScreen error', e); }
    }
}

// Forward incoming GAME_EVENT messages from the network to the current game
cm.handleEvent('GAME_EVENT', (msg) => {
    if (msg) onMessage(msg);
});

export default {
    setActiveGame,
    getActiveGameId,
    updateSettings,
    getCurrentSettings,
    sendGameMessage,
    onMessage,
    startVR,
    updateVR,
    startScreen,
    updateScreen
};
