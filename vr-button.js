class VRButton {
    static createButton(renderer) {
        const button = document.createElement('button');

        function showEnterVR( /*device*/) {
            let currentSession = null;

            async function onSessionStarted(session) {
                session.addEventListener('end', onSessionEnded);
                await renderer.xr.setSession(session);
                button.textContent = 'Exit VR';
                currentSession = session;
            }

            function onSessionEnded( /*event*/) {
                currentSession.removeEventListener('end', onSessionEnded);
                button.textContent = 'View in 3D VR';
                currentSession = null;
            }

            button.style.display = '';
            button.style.cursor = 'pointer';
            button.style.left = 'calc(50% - 70px)';
            button.style.width = '140px';

            button.textContent = 'View in 3D VR';

            button.onclick = () => {
                if (currentSession === null) {
                    // WebXR's requestReferenceSpace only works if the corresponding feature
                    // was requested at session creation time. For simplicity, just ask for
                    // the interesting ones as optional features, but be aware that the
                    // requestReferenceSpace call will fail if it turns out to be unavailable.
                    // ('local' is always available for immersive sessions and doesn't need to
                    // be requested separately.)

                    const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] };
                    navigator.xr.requestSession('immersive-vr', sessionInit).then(onSessionStarted);
                } else {
                    currentSession.end();
                }
            };
        }

        const disableButton = () => {
            button.style.display = 'none';

            button.onmouseenter = null;
            button.onmouseleave = null;

            button.onclick = null;
        }

        const showWebXRNotFound = () => {
            disableButton();
            // button.textContent = 'VR Device Not Found';
        }

        const showVRNotAllowed = (exception) => {
            disableButton();
            console.warn('Exception when trying to call xr.isSessionSupported', exception);
            // button.textContent = 'VR Not Allowed';
        }

        const stylizeElement = (element) => {
            element.style.display = '';
            element.style.position = 'absolute';
            element.style.bottom = '12px';
            element.style.padding = '12px 6px';
            element.style.border = '1px solid rgba(255, 255, 255, 0.6)';
            element.style.borderRadius = '6px';
            element.style.background = '#d97706';
            element.style.color = '#fff';
            element.style.fontSize = '18px';
            element.style.fontWeight = '700';
            element.style.fontFamily = 'lato, sans-serif';
            element.style.textAlign = 'center';
            element.style.outline = 'none';
            element.style.zIndex = '999';
        }

        if ('xr' in navigator) {
            button.id = 'VRButton';
            button.style.display = 'none';

            stylizeElement(button);

            navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
                supported ? showEnterVR() : showWebXRNotFound();

                if (supported && VRButton.xrSessionIsGranted) {
                    button.click();
                }

            }).catch(showVRNotAllowed);

            return button;

        } else {
            const message = document.createElement('a');

            if (window.isSecureContext === false) {
                message.href = document.location.href.replace(/^http:/, 'https:');
                message.innerHTML = 'VR Mode Requires HTTPS';
            } else {
                message.href = '#unavailable';
                message.innerHTML = 'VR Mode Unavailable (?)';
            }

            stylizeElement(message);

            message.style.display = 'none';
            // message.style.left = 'calc(50% - 120px)';
            // message.style.width = '240px';
            // message.style.textDecoration = 'none';
            // message.style.opacity = "0.7";
            // message.style.background = '#a3a3a3';
            // message.style.border = '1px solid #a3a3a3';

            return message;
        }
    }

    static registerSessionGrantedListener() {
        if ('xr' in navigator) {
            // WebXRViewer (based on Firefox) has a bug where addEventListener
            // throws a silent exception and aborts execution entirely.
            if (/WebXRViewer\//i.test(navigator.userAgent)) return;

            navigator.xr.addEventListener('sessiongranted', () => {
                VRButton.xrSessionIsGranted = true;
            });
        }
    }
}

VRButton.xrSessionIsGranted = false;
VRButton.registerSessionGrantedListener();

export { VRButton };
