/**
 * System-wide default settings that are not game-specific.
 * These settings control the overall application behavior.
 */
export const SYSTEM_DEFAULTS = {
    // The currently active game
    activeGameId: 'balls',
    
    // Screen display geometry mode
    screenGeometryMode: 'curved', // 'flat' or 'curved'
    
    // Debug visualization for hand tracking joints
    handJointsDebugEnabled: false,
};

/**
 * Metadata schema for system settings.
 * Used for UI generation and validation.
 */
export const SYSTEM_SETTINGS_METADATA = [
    {
        key: 'activeGameId',
        label: 'Active Game',
        type: 'select',
        default: 'balls',
        options: ['balls', 'paint', 'draw', 'tutorial'],
        tab: 'system',
        description: 'The current game to load'
    },
    {
        key: 'screenGeometryMode',
        label: 'Screen Geometry',
        type: 'select',
        default: 'curved',
        options: ['flat', 'curved'],
        tab: 'system',
        description: 'Display mode for the 2D screen'
    },
    {
        key: 'handJointsDebugEnabled',
        label: 'Show Hand Joints (Debug)',
        type: 'boolean',
        default: false,
        tab: 'system',
        description: 'Visualize hand tracking joint positions (global debug feature)'
    }
];
