const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const connectedClients = new Map();
let wallRegistered = false;
let isShuttingDown = false;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

const routes = [
    { path: '/', file: 'index.html' },
    { path: '/vr', file: 'vr.html' },
    { path: '/desktop', file: 'desktop.html' },
    { path: '/wall', file: 'wall.html' },
];
routes.forEach((route) => {
    app.get(route.path, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', route.file));
    });
});

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
        case 'WALL_CALIBRATION':
            for (const [clientWS, clientInfo] of connectedClients) {
                if (clientInfo.type === 'VR') {
                    sendMessage(clientWS, { type: 'WALL_CALIBRATION', message: data.message });
                }
            }
            break;
        case 'CALIBRATION_COMMIT':
            for (const [clientWS, clientInfo] of connectedClients) {
                if (clientInfo.type === 'WALL') {
                    sendMessage(clientWS, { type: 'CALIBRATION_COMMIT', message: data.message });
                }
            }
            break;
        case 'VR_CONTROLLER_STATE':
            const senderClientInfo = connectedClients.get(ws);
            const userID = senderClientInfo.userID;
            let wallClient = getWallClient();
            if (wallClient) {
                sendMessage(wallClient, { type: data.type, message: { ...data.message, userID } });
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
        case 'WALL':
            if (wallRegistered) {
                sendMessage(ws, { type: 'REGISTRATION_ERROR', message: 'Wall client already registered' });
            } else {
                wallRegistered = true;
                ws.clientType = 'WALL';
                ws.userID = uuidv4();
                connectedClients.set(ws, { type: 'WALL', userID: ws.userID });
                sendMessage(ws, { type: 'REGISTRATION_SUCCESS', message: 'Successfully registered as WALL client' });
                console.log('WALL client registered');
                for (const [wsIter, clientInfo] of connectedClients) {
                    if (clientInfo.type !== 'WALL') {
                        sendMessage(getWallClient(), { type: 'NEW_CLIENT', message: { type: clientInfo.type, userID: clientInfo.userID } });
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
            if (wallRegistered) {
                sendMessage(getWallClient(), { type: 'NEW_CLIENT', message: { type: clientType, userID: ws.userID } });
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
    if (clientInfo.type === 'WALL') {
        if (wallRegistered) {
            for (const [clientWS, info] of connectedClients) {
                if (info.type === 'VR') {
                    sendMessage(clientWS, { type: 'WALL_DISCONNECTED', message: 'Wall client disconnected' });
                }
            }
        }
        wallRegistered = false;
        console.log('Wall registered reset');
    } else {
        if (wallRegistered) {
            sendMessage(getWallClient(), { type: 'CLIENT_DISCONNECTED', message: { type: clientInfo.type, userID: clientInfo.userID } });
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

function getWallClient() {
    if (!wallRegistered) return null;
    for (const [ws, clientInfo] of connectedClients) {
        if (clientInfo.type === 'WALL') return ws;
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

server.listen(port, () => { console.log(`HTTP/WebSocket servers listening on port ${port}`); });

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGQUIT', () => handleShutdown('SIGQUIT'));
process.on('uncaughtException', (error) => { console.error('Uncaught Exception:', error); handleShutdown('uncaughtException'); });
process.on('unhandledRejection', (error) => { console.error('Unhandled Rejection:', error); handleShutdown('unhandledRejection'); });