if (window.location.search.includes('settings')) {
    window.location.href = '/settings';
} else if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (supported) {
            window.location.href = '/vr';
        } else {
            window.location.href = '/desktop';
        }
    });
} else {
    window.location.href = '/desktop';
}