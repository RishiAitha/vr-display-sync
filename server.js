// express and websocket server setup
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// info on clients
const connectedClients = new Map();
let wallRegistered = false;

let isShuttingDown = false;

app.use(express.json()); // start up app
app.use(express.static(path.join(__dirname, 'dist'))); // serve JS bundles
app.use(express.static(path.join(__dirname, 'public'))); // serve static files

// http routes
const routes = [
    { path: '/', file: 'index.html' },
    { path: '/vr', file: 'vr.html' },
    { path: '/desktop', file: 'desktop.html' },
    { path: '/wall', file: 'wall.html' },
];

// set up files for each route
routes.forEach((route) => {
    app.get(route.path, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', route.file));
    });
});

// handle message coming to server
function handleMessage(ws, data) {
    if (!data.type) {
        sendError(ws, 'No data type specified');
        return;
    }

    switch (data.type) {
        case 'REGISTER_CLIENT': // client wants to register to the server
            handleClientRegistration(ws, data);
            break;
        case 'ERROR': // client told server there was an error
            console.error('Client sent error:', data.message);
            break;
        case 'WALL_CALIBRATION':
            for (const [clientWS, clientInfo] of connectedClients) {
                if (clientInfo.type === 'VR') {
                    sendMessage(clientWS, {
                        type: 'WALL_CALIBRATION',
                        message: data.message
                    });
                }
            }
            break;
        case 'VR_CONTROLLER_STATE': // handle vr client input
            const senderClientInfo = connectedClients.get(ws);
            const userID = senderClientInfo.userID;
            let wallClient = getWallClient();
            if (wallClient) {
                sendMessage(wallClient, {
                    type: data.type,
                    message: { ...data.message, userID }
                });
            }
            break;
        default:
            sendError(ws, 'Data type has no matches');
            break;
    }
}

// handle a new client being registered
function handleClientRegistration(ws, data) {
    const { clientType } = data; // take the client type from the given data

    if (!clientType) {
        sendError(ws, 'Client type is required');
        return;
    }

    switch (clientType) {
        case 'WALL': // wall type connected
            if (wallRegistered) { // we already have a wall, send a registration error
                // this needs to be handled as a separate message because
                // errors during registration impact connection state
                sendMessage(ws, {
                    type: 'REGISTRATION_ERROR',
                    message: 'Wall client already registered'
                });
            } else {
                wallRegistered = true; // mark that a wall has been connected
                // store wall client with websocket and tell client it is successful
                ws.clientType = 'WALL';
                ws.userID = uuidv4();
                connectedClients.set(ws, { type: 'WALL', userID: ws.userID });
                sendMessage(ws, {
                    type: 'REGISTRATION_SUCCESS',
                    message: 'Successfully registered as WALL client'
                });
                console.log('WALL client registered');
                for (const [ws, clientInfo] of connectedClients) {
                    if (clientInfo.type !== 'WALL') {
                        sendMessage(getWallClient(), {
                            type: 'NEW_CLIENT',
                            message: {
                                type: clientInfo.type,
                                userID: clientInfo.userID
                            }
                        });
                    }
                }
            }
            break;
        case 'VR':
        case 'DESKTOP':
            // store vr or desktop client with websocket and tell client it is successful
            ws.clientType = clientType;
            ws.userID = uuidv4();
            connectedClients.set(ws, {
                type: clientType,
                userID: ws.userID
            });
            sendMessage(ws, {
                type: 'REGISTRATION_SUCCESS',
                message: `Successfully registered as ${clientType} client`
            });
            if (wallRegistered) {
                sendMessage(getWallClient(), {
                    type: 'NEW_CLIENT',
                    message: {
                        type: clientType,
                        userID: ws.userID
                    }
                });
            }
            console.log(`${clientType} client registered`);
            break;
        default:
            sendError(ws, `Unknown client type: ${clientType}`);
            break;
    }
}

function handleDisconnection(ws) { // runs when a client websocket closes
    const clientInfo = connectedClients.get(ws);
    if (clientInfo) {
        if (clientInfo.type === 'WALL') { // updates relevant info on connected wall
            if (wallRegistered) {
                for (const [clientWS, info] of connectedClients) {
                    if (info.type === 'VR') {
                        sendMessage(clientWS, {
                            type: 'WALL_DISCONNECTED',
                            message: 'Wall client disconnected'
                        });
                    }
                }
            }
            wallRegistered = false;
            console.log('Wall registered reset');
        } else {
            if (wallRegistered) {
                sendMessage(getWallClient(), {
                    type: 'CLIENT_DISCONNECTED',
                    message: {
                        type: clientInfo.type,
                        userID: clientInfo.userID
                    }
                })
            }
        }

        // removes client from client storage
        console.log(`${clientInfo.type} client disconnected`);
        connectedClients.delete(ws);
    }
}

function sendMessage(ws, message) { // sends message to client
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function sendError(ws, message) { // sends message of type 'ERROR' to client
    // use this for general, simple errors, specific stuff like registration errors
    // can instead have their own error types when appropriate
    sendMessage(ws, {
        type: 'ERROR',
        message: message
    });
}

function getWallClient() {
    if (!wallRegistered) return null;
    for (const [ws, clientInfo] of connectedClients) {
        if (clientInfo.type === 'WALL') {
            return ws;
        }
    }
    return null;
}

wss.on('connection', (ws) => { // runs when a client connects to the server
    console.log('New WebSocket connection established');

    ws.on('message', (rawData) => { // runs when a client sends a message to the server
        if (isShuttingDown) return;

        try {
            const data = JSON.parse(rawData);
            //console.log('Received data:', data);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Failed to parse JSON:', error);
            sendError(ws, 'Invalid JSON format');
        }
    });

    ws.on('close', () => { // runs when a client websocket disconnects from the server
        handleDisconnection(ws);
    });
});

// handle server shutdowns for websockets and clients
async function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\nReceived ${signal}, shutting down servers`);

    const forceExit = setTimeout(() => process.exit(1), 3000).unref();
    
    try {
        for (const [ws] of connectedClients) {
            if (ws.readyState === WebSocket.OPEN) {
                await new Promise(resolve => {
                    ws.once('close', resolve);
                    ws.close();
                })
            }
        }

        await new Promise(resolve => wss.close(resolve));
        console.log('WebSocket server closed');
        await new Promise(resolve => server.close(resolve));
        console.log('HTTP server closed');

        clearTimeout(forceExit);
        process.exit(0);
    } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
    }
}

server.listen(port, () => { // turns on websocket server on port
    console.log(`HTTP/WebSocket servers listening on port ${port}`);
});

// handle all shutdown processes
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGQUIT', () => handleShutdown('SIGQUIT'));

process.on('uncaughtException', (error) => { // shutdown on uncaught exception
    console.error('Uncaught Exception:', error);
    handleShutdown('uncaughtException');
});

process.on('unhandledRejection', (error) => { // shutdown on unhandled rejection
    console.error('Unhandled Rejection:', error);
    handleShutdown('unhandledRejection');
});