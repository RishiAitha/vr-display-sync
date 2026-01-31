// Desktop client - fallback for devices without XR support

import * as cm from './clientManager.js';

// Redirect to VR if supported
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (supported) window.location.href = '/vr';
    });
}

// Display connection status
const statusDisplay = document.createElement('div');
statusDisplay.id = 'connection-status';
document.body.appendChild(statusDisplay);

function updateStatus() {
    const state = cm.getConnectionState();
    statusDisplay.textContent = `Connection Status: ${state.state}`;
}

// Register as desktop client
cm.registerToServer('DESKTOP')
    .then(updateStatus)
    .catch((error) => {
        console.error('Failed to register:', error);
        updateStatus();
    });

cm.handleEvent('CLOSE', updateStatus);
