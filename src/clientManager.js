let ws = null;
let connectionState = 'disconnected';
let clientType = null;
const eventActions = new Map();

/*
    Reserved message types used by the system. Game authors should avoid
    using these as top-level `type` values for their own messages to
    prevent collisions with infrastructure messages. Import `RESERVED_MESSAGE_TYPES`
    if you need to check for collisions.

    Examples:
        REGISTER_CLIENT, REGISTRATION_SUCCESS, REGISTRATION_ERROR,
        NEW_CLIENT, CLIENT_DISCONNECTED,
        CALIBRATION_COMMIT, SCREEN_CALIBRATION, SCREEN_DISCONNECTED,
        GAME_EVENT, ERROR
*/
export const RESERVED_MESSAGE_TYPES = [
        'REGISTER_CLIENT', 'REGISTRATION_SUCCESS', 'REGISTRATION_ERROR',
        'NEW_CLIENT', 'CLIENT_DISCONNECTED',
        'CALIBRATION_COMMIT', 'SCREEN_CALIBRATION', 'SCREEN_DISCONNECTED',
        'GAME_EVENT', 'ERROR'
];

export function registerToServer(type) {
    return new Promise((resolve, reject) => {
        if (connectionState === 'connecting') return reject(new Error('Connection already in progress'));
        clientType = type;
        if (ws) clearSocket();

        connectionState = 'connecting';
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${window.location.host}`;
        ws = new WebSocket(wsUrl);

        const timeout = setTimeout(() => {
            connectionState = 'disconnected';
            reject(new Error('Connection timeout'));
            if (ws) ws.close();
        }, 10000);

        let registrationResolver = null;
        let registrationRejector = null;

        ws.onopen = () => {
            registrationResolver = resolve;
            registrationRejector = reject;
            connectionState = 'connected';
            ws.send(JSON.stringify({ type: 'REGISTER_CLIENT', clientType: type }));
        };

        ws.onmessage = ({ data }) => {
            try {
                const message = JSON.parse(data);
                handleIncomingMessage(message, { resolve: registrationResolver, reject: registrationRejector, timeout });
            } catch (error) {
                console.error('Failed to parse message:', error);
                sendError('Invalid JSON format');
            }
        };

        ws.onclose = (event) => {
            clearTimeout(timeout);
            const handlerFunction = eventActions.get('CLOSE');
            if (typeof handlerFunction === 'function') handlerFunction();
            if (registrationRejector && connectionState === 'connecting') registrationRejector(new Error('Connection closed before registration completed'));
            disconnect();
        };

        ws.onerror = (error) => {
            clearTimeout(timeout);
            console.error('WebSocket error:', error);
            const handlerFunction = eventActions.get('CLOSE');
            if (typeof handlerFunction === 'function') handlerFunction();
            if (registrationRejector && connectionState === 'connecting') registrationRejector(error);
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
            if (resolve) resolve({ success: true, message: message.message, clientType });
            break;
        case 'REGISTRATION_ERROR':
            clearTimeout(timeout);
            connectionState = 'connected';
            if (reject) reject(new Error(message.message));
            break;
        case 'NEW_CLIENT':
        case 'CLIENT_DISCONNECTED':
        case 'CALIBRATION_COMMIT':
            if (clientType === 'SCREEN') {
                const handlerFunction = eventActions.get(message.type);
                if (typeof handlerFunction === 'function') handlerFunction(message.message);
            }
            break;
        case 'SCREEN_CALIBRATION':
        case 'SCREEN_DISCONNECTED':
            if (clientType === 'VR') {
                const handlerFunction = eventActions.get(message.type);
                if (typeof handlerFunction === 'function') handlerFunction(message.message);
            }
            break;
        case 'ERROR':
            console.error('Server sent error:', message.message);
            break;
        case 'GAME_EVENT':
            // Forward game-level events to any registered handler (both SCREEN and VR should receive)
            {
                const handlerFunction = eventActions.get('GAME_EVENT');
                if (typeof handlerFunction === 'function') handlerFunction(message.message);
            }
            break;
        default:
            sendError('Data type has no matches');
            break;
    }
}

export function sendMessage(message) {
    if (!isRegistered()) throw new Error('Not registered to server');
    ws.send(JSON.stringify(message));
}

export function handleEvent(type, handlerFunction) {
    eventActions.set(type, handlerFunction);
}

function sendError(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ERROR', message }));
    }
}

function clearSocket() {
    if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
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
    return { state: connectionState, clientType, isRegistered: isRegistered() };
}

export function isRegistered() {
    return ws && ws.readyState === WebSocket.OPEN && connectionState === 'registered';
}

export function sendGameMessage(payload) {
    // Convenience wrapper for game-level events
    sendMessage({ type: 'GAME_EVENT', message: payload });
}