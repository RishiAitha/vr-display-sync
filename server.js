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

// Load settings from config file
const defaultsPath = path.join(__dirname, 'config', 'defaults.json');
const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

// Initialize appConfig with system defaults + all game defaults dynamically
const appConfig = {
    ...defaults.systemDefaults
};

// Merge all game defaults from config file
for (const gameId in defaults.gameDefaults) {
    Object.assign(appConfig, defaults.gameDefaults[gameId]);
}

function saveDefaultsConfig() {
    try {
        // Update the defaults structure and save back to defaults.json
        const updatedDefaults = {
            systemDefaults: {},
            gameDefaults: {}
        };
        
        // Reconstruct systemDefaults from current appConfig
        for (const key of Object.keys(defaults.systemDefaults)) {
            updatedDefaults.systemDefaults[key] = appConfig[key];
        }
        
        // Reconstruct gameDefaults from current appConfig
        for (const gameId in defaults.gameDefaults) {
            updatedDefaults.gameDefaults[gameId] = {};
            for (const key of Object.keys(defaults.gameDefaults[gameId])) {
                updatedDefaults.gameDefaults[gameId][key] = appConfig[key];
            }
        }
        
        fs.writeFileSync(defaultsPath, JSON.stringify(updatedDefaults, null, 2));
    } catch (e) {
        console.warn('Failed to save config to defaults.json:', e);
    }
}

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

    // Update any setting that exists in our config
    for (const key in next) {
        if (key in appConfig) {
            const value = next[key];
            const currentValue = appConfig[key];
            const valueType = typeof currentValue;
            
            // Type-check and apply the value
            if (typeof value === valueType) {
                // Additional validation for specific settings
                if (key === 'screenGeometryMode') {
                    const mode = String(value).toLowerCase();
                    if (mode === 'flat' || mode === 'curved') {
                        appConfig[key] = mode;
                        changed = true;
                    }
                } else if (valueType === 'number' && Number.isFinite(value)) {
                    appConfig[key] = value;
                    changed = true;
                } else {
                    appConfig[key] = value;
                    changed = true;
                }
            }
        }
    }
    
    // Legacy compatibility: allow setting absolute gravity and convert it to a multiplier.
    if (typeof next.gravityPixelsPerSec2 === 'number' && Number.isFinite(next.gravityPixelsPerSec2)) {
        appConfig.gravityMultiplier = next.gravityPixelsPerSec2 / 980;
        changed = true;
    }

    if (changed) {
        saveDefaultsConfig();
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