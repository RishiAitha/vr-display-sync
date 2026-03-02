const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const sslKeyPath = process.env.SSL_KEY;
const sslCertPath = process.env.SSL_CERT;

const appConfig = {
    activeGameId: 'balls',
    screenGeometryMode: 'curved',
    displayOverlayEnabled: true,
    gravityMultiplier: 1.0,
    swipeForceMultiplier: 1.0,
    handJointsDebugEnabled: false,
    handTouchRadiusMeters: 0.06,
    handMinSwipeSpeedMetersPerSec: 0.25,
    handSwipeBallCooldownSec: 0.10,
    drawColorHex: '#111111',
    drawThicknessPx: 20,
    drawAlpha: 0.22,
};

const persistedConfigPath = path.join(__dirname, '.server-config.json');

function applyPersistedConfig(raw) {
    if (!raw || typeof raw !== 'object') return;

    if (typeof raw.activeGameId === 'string') {
        appConfig.activeGameId = raw.activeGameId;
    }

    if (typeof raw.screenGeometryMode === 'string') {
        const mode = String(raw.screenGeometryMode).toLowerCase();
        if (mode === 'flat' || mode === 'curved') appConfig.screenGeometryMode = mode;
    }
    if (typeof raw.displayOverlayEnabled === 'boolean') {
        appConfig.displayOverlayEnabled = raw.displayOverlayEnabled;
    }
    if (typeof raw.gravityMultiplier === 'number' && Number.isFinite(raw.gravityMultiplier)) {
        appConfig.gravityMultiplier = raw.gravityMultiplier;
    }
    if (typeof raw.swipeForceMultiplier === 'number' && Number.isFinite(raw.swipeForceMultiplier)) {
        appConfig.swipeForceMultiplier = raw.swipeForceMultiplier;
    }
    if (typeof raw.handJointsDebugEnabled === 'boolean') {
        appConfig.handJointsDebugEnabled = raw.handJointsDebugEnabled;
    }
    if (typeof raw.handTouchRadiusMeters === 'number' && Number.isFinite(raw.handTouchRadiusMeters)) {
        appConfig.handTouchRadiusMeters = raw.handTouchRadiusMeters;
    }
    if (typeof raw.handMinSwipeSpeedMetersPerSec === 'number' && Number.isFinite(raw.handMinSwipeSpeedMetersPerSec)) {
        appConfig.handMinSwipeSpeedMetersPerSec = raw.handMinSwipeSpeedMetersPerSec;
    }
    if (typeof raw.handSwipeBallCooldownSec === 'number' && Number.isFinite(raw.handSwipeBallCooldownSec)) {
        appConfig.handSwipeBallCooldownSec = raw.handSwipeBallCooldownSec;
    }

    if (typeof raw.drawColorHex === 'string') {
        appConfig.drawColorHex = raw.drawColorHex;
    }
    if (typeof raw.drawThicknessPx === 'number' && Number.isFinite(raw.drawThicknessPx)) {
        appConfig.drawThicknessPx = raw.drawThicknessPx;
    }
    if (typeof raw.drawAlpha === 'number' && Number.isFinite(raw.drawAlpha)) {
        appConfig.drawAlpha = raw.drawAlpha;
    }
}

function loadPersistedConfig() {
    try {
        if (!fs.existsSync(persistedConfigPath)) return;
        const text = fs.readFileSync(persistedConfigPath, 'utf8');
        const raw = JSON.parse(text);
        applyPersistedConfig(raw);
    } catch (e) {
        console.warn('Failed to load persisted server config:', e);
    }
}

function savePersistedConfig() {
    try {
        fs.writeFileSync(persistedConfigPath, JSON.stringify(appConfig, null, 2));
    } catch (e) {
        console.warn('Failed to save persisted server config:', e);
    }
}

loadPersistedConfig();

const server = (sslKeyPath && sslCertPath)
    ? https.createServer(
        {
            key: fs.readFileSync(sslKeyPath),
            cert: fs.readFileSync(sslCertPath),
        },
        app
    )
    : http.createServer(app);
const wss = new WebSocket.Server({ server });

const connectedClients = new Map();
let screenRegistered = false;
let isShuttingDown = false;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

const routes = [
    { path: '/', file: 'index.html' },
    { path: '/vr', file: 'vr.html' },
    { path: '/desktop', file: 'desktop.html' },
    { path: '/screen', file: 'screen.html' },
    { path: '/settings', file: 'settings.html' },
];
routes.forEach((route) => {
    app.get(route.path, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', route.file));
    });
});

app.get('/api/config', (req, res) => {
    res.json(appConfig);
});

app.post('/api/config', (req, res) => {
    const next = req.body || {};
    let changed = false;

    if (typeof next.activeGameId === 'string') {
        appConfig.activeGameId = next.activeGameId;
        changed = true;
    }
    if (typeof next.screenGeometryMode === 'string') {
        const mode = String(next.screenGeometryMode).toLowerCase();
        if (mode === 'flat' || mode === 'curved') {
            appConfig.screenGeometryMode = mode;
            changed = true;
        }
    }
    if (typeof next.displayOverlayEnabled === 'boolean') {
        appConfig.displayOverlayEnabled = next.displayOverlayEnabled;
        changed = true;
    }
    if (typeof next.handJointsDebugEnabled === 'boolean') {
        appConfig.handJointsDebugEnabled = next.handJointsDebugEnabled;
        changed = true;
    }
    if (typeof next.handTouchRadiusMeters === 'number' && Number.isFinite(next.handTouchRadiusMeters)) {
        appConfig.handTouchRadiusMeters = next.handTouchRadiusMeters;
        changed = true;
    }
    if (typeof next.handMinSwipeSpeedMetersPerSec === 'number' && Number.isFinite(next.handMinSwipeSpeedMetersPerSec)) {
        appConfig.handMinSwipeSpeedMetersPerSec = next.handMinSwipeSpeedMetersPerSec;
        changed = true;
    }
    if (typeof next.handSwipeBallCooldownSec === 'number' && Number.isFinite(next.handSwipeBallCooldownSec)) {
        appConfig.handSwipeBallCooldownSec = next.handSwipeBallCooldownSec;
        changed = true;
    }
    if (typeof next.swipeForceMultiplier === 'number' && Number.isFinite(next.swipeForceMultiplier)) {
        appConfig.swipeForceMultiplier = next.swipeForceMultiplier;
        changed = true;
    }
    if (typeof next.gravityMultiplier === 'number' && Number.isFinite(next.gravityMultiplier)) {
        appConfig.gravityMultiplier = next.gravityMultiplier;
        changed = true;
    }
    // Legacy compatibility: allow setting absolute gravity and convert it to a multiplier.
    if (typeof next.gravityPixelsPerSec2 === 'number' && Number.isFinite(next.gravityPixelsPerSec2)) {
        appConfig.gravityMultiplier = next.gravityPixelsPerSec2 / 980;
        changed = true;
    }

    if (typeof next.drawColorHex === 'string') {
        appConfig.drawColorHex = next.drawColorHex;
        changed = true;
    }
    if (typeof next.drawThicknessPx === 'number' && Number.isFinite(next.drawThicknessPx)) {
        appConfig.drawThicknessPx = next.drawThicknessPx;
        changed = true;
    }
    if (typeof next.drawAlpha === 'number' && Number.isFinite(next.drawAlpha)) {
        appConfig.drawAlpha = next.drawAlpha;
        changed = true;
    }

    if (changed) {
        savePersistedConfig();
        broadcastConfig();
    }
    res.json(appConfig);
});

app.post('/api/draw/clear', (req, res) => {
    for (const [clientWS] of connectedClients) {
        sendMessage(clientWS, { type: 'GAME_EVENT', message: { event: 'DRAW_CLEAR' } });
    }
    res.json({ ok: true });
});

function broadcastConfig() {
    for (const [clientWS] of connectedClients) {
        sendMessage(clientWS, { type: 'CONFIG_UPDATE', message: appConfig });
    }
}

function handleMessage(ws, data) {
    if (!data.type) {
        sendError(ws, 'No data type specified');
        return;
    }
    switch (data.type) {
        case 'REGISTER_CLIENT':
            handleClientRegistration(ws, data);
            break;
        case 'ERROR':
            console.error('Client sent error:', data.message);
            break;
        case 'SCREEN_CALIBRATION':
            for (const [clientWS, clientInfo] of connectedClients) {
                if (clientInfo.type === 'VR') {
                    sendMessage(clientWS, { type: 'SCREEN_CALIBRATION', message: data.message });
                }
            }
            break;
        case 'CALIBRATION_COMMIT':
            for (const [clientWS, clientInfo] of connectedClients) {
                if (clientInfo.type === 'SCREEN') {
                    sendMessage(clientWS, { type: 'CALIBRATION_COMMIT', message: data.message });
                }
            }
            break;
        case 'GAME_EVENT':
            // Forward game-level events to all connected clients (so games can coordinate)
            for (const [clientWS] of connectedClients) {
                sendMessage(clientWS, { type: 'GAME_EVENT', message: data.message });
            }
            break;
        default:
            sendError(ws, 'Data type has no matches');
            break;
    }
}

function handleClientRegistration(ws, data) {
    const { clientType } = data;
    if (!clientType) {
        sendError(ws, 'Client type is required');
        return;
    }
    switch (clientType) {
        case 'SCREEN':
            if (screenRegistered) {
                sendMessage(ws, { type: 'REGISTRATION_ERROR', message: 'Screen client already registered' });
            } else {
                screenRegistered = true;
                ws.clientType = 'SCREEN';
                ws.userID = uuidv4();
                connectedClients.set(ws, { type: 'SCREEN', userID: ws.userID });
                sendMessage(ws, { type: 'REGISTRATION_SUCCESS', message: 'Successfully registered as SCREEN client' });
                sendMessage(ws, { type: 'CONFIG_UPDATE', message: appConfig });
                console.log('SCREEN client registered');
                for (const [wsIter, clientInfo] of connectedClients) {
                    if (clientInfo.type !== 'SCREEN') {
                        sendMessage(getScreenClient(), { type: 'NEW_CLIENT', message: { type: clientInfo.type, userID: clientInfo.userID } });
                    }
                }
            }
            break;
        case 'VR':
        case 'DESKTOP':
            ws.clientType = clientType;
            ws.userID = uuidv4();
            connectedClients.set(ws, { type: clientType, userID: ws.userID });
            sendMessage(ws, { type: 'REGISTRATION_SUCCESS', message: `Successfully registered as ${clientType} client` });
            sendMessage(ws, { type: 'CONFIG_UPDATE', message: appConfig });
            if (screenRegistered) {
                sendMessage(getScreenClient(), { type: 'NEW_CLIENT', message: { type: clientType, userID: ws.userID } });
            }
            console.log(`${clientType} client registered`);
            break;
        default:
            sendError(ws, `Unknown client type: ${clientType}`);
            break;
    }
}

function handleDisconnection(ws) {
    const clientInfo = connectedClients.get(ws);
    if (!clientInfo) return;
    if (clientInfo.type === 'SCREEN') {
        if (screenRegistered) {
            for (const [clientWS, info] of connectedClients) {
                if (info.type === 'VR') {
                    sendMessage(clientWS, { type: 'SCREEN_DISCONNECTED', message: 'Screen client disconnected' });
                }
            }
        }
        screenRegistered = false;
        console.log('Screen registered reset');
    } else {
        if (screenRegistered) {
            sendMessage(getScreenClient(), { type: 'CLIENT_DISCONNECTED', message: { type: clientInfo.type, userID: clientInfo.userID } });
        }
    }
    console.log(`${clientInfo.type} client disconnected`);
    connectedClients.delete(ws);
}

function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendError(ws, message) {
    sendMessage(ws, { type: 'ERROR', message });
}

function getScreenClient() {
    if (!screenRegistered) return null;
    for (const [ws, clientInfo] of connectedClients) {
        if (clientInfo.type === 'SCREEN') return ws;
    }
    return null;
}

wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    ws.on('message', (rawData) => {
        if (isShuttingDown) return;
        try {
            const data = JSON.parse(rawData);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Failed to parse JSON:', error);
            sendError(ws, 'Invalid JSON format');
        }
    });
    ws.on('close', () => { handleDisconnection(ws); });
});

async function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down servers`);
    const forceExit = setTimeout(() => process.exit(1), 3000).unref();
    try {
        for (const [ws] of connectedClients) {
            if (ws.readyState === WebSocket.OPEN) {
                await new Promise(resolve => { ws.once('close', resolve); ws.close(); });
            }
        }
        await new Promise(resolve => wss.close(resolve));
        await new Promise(resolve => server.close(resolve));
        clearTimeout(forceExit);
        process.exit(0);
    } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
    }
}

server.listen(port, () => {
    const isHttps = !!(sslKeyPath && sslCertPath);
    const scheme = isHttps ? 'https' : 'http';
    console.log(`${scheme.toUpperCase()}/WebSocket servers listening on ${scheme}://localhost:${port}`);
    if (isHttps) {
        console.log(`Using SSL_KEY=${sslKeyPath}`);
        console.log(`Using SSL_CERT=${sslCertPath}`);
    } else {
        console.log('Tip: set SSL_KEY and SSL_CERT env vars (or use `npm run dev:https`) to enable HTTPS.');
    }
});

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGQUIT', () => handleShutdown('SIGQUIT'));
process.on('uncaughtException', (error) => { console.error('Uncaught Exception:', error); handleShutdown('uncaughtException'); });
process.on('unhandledRejection', (error) => { console.error('Unhandled Rejection:', error); handleShutdown('unhandledRejection'); });