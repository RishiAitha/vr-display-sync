let ws = null;
let connectionState = 'disconnected';
let clientType = null;
const eventActions = new Map();

export function registerToServer(type) {
    return new Promise((resolve, reject) => {
        if (connectionState === 'connecting') {
            reject(new Error('Connection already in progress'));
            return;
        }

        clientType = type;
        
        if (ws) {
            clearSocket();
        }

        connectionState = 'connecting';
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${window.location.host}`;
        ws = new WebSocket(wsUrl);

        const timeout = setTimeout(() => {
            connectionState = 'disconnected';
            reject(new Error('Connection timeout'));
            if (ws) {
                ws.close();
            }
        }, 10000);

        let registrationResolver = null;
        let registrationRejector = null;

        ws.onopen = () => {
            registrationResolver = resolve;
            registrationRejector = reject;
            
            console.log('WebSocket connection opened');
            connectionState = 'connected';

            ws.send(JSON.stringify({
                type: 'REGISTER_CLIENT',
                clientType: type
            }));

            console.log('Registration request sent for:', type);
        };

        ws.onmessage = ({ data }) => {
            try {
                const message = JSON.parse(data);
                //console.log('Recieved message:', message);

                handleIncomingMessage(message, {
                    resolve: registrationResolver,
                    reject: registrationRejector,
                    timeout
                });
            } catch (error) {
                console.error('Failed to parse message:', error);
                sendError('Invalid JSON format');
            }
        };

        ws.onclose = (event) => {
            clearTimeout(timeout);
            
            let handlerFunction = eventActions.get('CLOSE');
            if (typeof handlerFunction === 'function') {
                handlerFunction();
            }

            if (registrationRejector && connectionState === 'connecting') {
                registrationRejector(new Error('Connection closed before registration completed'));
            }

            disconnect();
        }

        ws.onerror = (error) => {
            clearTimeout(timeout);
            console.error('WebSocket error:', error);

            let handlerFunction = eventActions.get('CLOSE');
            if (typeof handlerFunction === 'function') {
                handlerFunction();
            }

            if (registrationRejector && connectionState === 'connecting') {
                registrationRejector(error);
            }
            
            disconnect();
        };
    });
}

function handleIncomingMessage(message, { resolve, reject, timeout }) {
    if (!message.type) {
        sendError('No message type specified');
        return;
    }

    switch (message.type) {
        case 'REGISTRATION_SUCCESS':
            clearTimeout(timeout);
            connectionState = 'registered';
            console.log('Registration successful:', message.message);
            if (resolve) {
                resolve({
                    success: true,
                    message: message.message,
                    clientType: clientType
                });
            }
            break;
        case 'REGISTRATION_ERROR':
            clearTimeout(timeout);
            connectionState = 'connected';
            console.error('Registration failed:', message.message);
            if (reject) {
                reject(new Error(message.message));
            }
            break;
        case 'VR_CONTROLLER_STATE':
        case 'NEW_CLIENT':
        case 'CLIENT_DISCONNECTED':
            if (clientType === 'WALL') {
                let handlerFunction = eventActions.get(message.type);
                if (typeof handlerFunction === 'function') {
                    handlerFunction(message.message);
                }
            }
            break;
        case 'WALL_CALIBRATION':
        case 'WALL_DISCONNECTED':
            if (clientType === 'VR') {
                let handlerFunction = eventActions.get(message.type);
                if (typeof handlerFunction === 'function') {
                    handlerFunction(message.message);
                }
            }
            break;
        case 'ERROR':
            console.error('Server sent error:', message.message);
            break;
        default:
            sendError('Data type has no matches');
            break;
    }
}

export function sendMessage(message) {
    if (!isRegistered()) {
        throw new Error('Not registered to server');
    }

    ws.send(JSON.stringify(message));
}

export function handleEvent(type, handlerFunction) {
    eventActions.set(type, handlerFunction);
}

function sendError(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            message: message
        }));
    }
}

function clearSocket() {
    if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
        ws = null;
    }
}

export function disconnect() {
    clearSocket();
    connectionState = 'disconnected';
    clientType = null;
    console.log('Disconnected from server');
}

export function getConnectionState() {
    return {
        state: connectionState,
        clientType: clientType,
        isRegistered: isRegistered()
    };
}

export function isRegistered() {
    return ws && ws.readyState === WebSocket.OPEN && connectionState === 'registered';
}