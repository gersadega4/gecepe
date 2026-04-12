function getRandomFingerprint() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    return {
        hardwareConcurrency: pick([2, 4, 6, 8]),
        deviceMemory: pick([2, 4, 8]),
        languages: pick([
            ["en-US", "en"],
            ["id-ID", "id"],
            ["en-GB", "en"]
        ]),
        platform: pick(["Win32", "MacIntel", "Linux x86_64"]),
        webglVendor: pick([
            "Intel Inc.",
            "NVIDIA Corporation",
            "AMD"
        ]),
        webglRenderer: pick([
            "Intel Iris OpenGL Engine",
            "NVIDIA GeForce GTX 1650",
            "AMD Radeon RX 580"
        ]),
        timezone: pick([
            "Asia/Jakarta",
            "Asia/Singapore",
            "Asia/Bangkok",
            "UTC"
        ]),
        viewport: {
            width: 1200 + Math.floor(Math.random() * 400),
            height: 700 + Math.floor(Math.random() * 300)
        },
        locale: pick(["en-US", "id-ID", "en-GB"])
    };
}

function applyFingerprint(context, fp) {
    return context.addInitScript((fp) => {

        // =========================
        // Navigator spoof
        // =========================
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => fp.hardwareConcurrency
        });

        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => fp.deviceMemory
        });

        Object.defineProperty(navigator, 'languages', {
            get: () => fp.languages
        });

        Object.defineProperty(navigator, 'platform', {
            get: () => fp.platform
        });

        // =========================
        // WebGL spoof
        // =========================
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return fp.webglVendor;
            if (parameter === 37446) return fp.webglRenderer;
            return getParameter.call(this, parameter);
        };

        // =========================
        // Canvas noise
        // =========================
        const toDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function() {
            const ctx = this.getContext('2d');
            if (ctx) {
                ctx.fillStyle = "rgba(0,0,0,0.01)";
                ctx.fillRect(0, 0, 10, 10);
            }
            return toDataURL.apply(this, arguments);
        };

        // =========================
        // AudioContext fingerprint (extra)
        // =========================
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function() {
            const results = originalGetChannelData.apply(this, arguments);
            for (let i = 0; i < results.length; i += 100) {
                results[i] = results[i] + Math.random() * 0.0001;
            }
            return results;
        };

        // =========================
        // WebRTC leak protection
        // =========================
        Object.defineProperty(navigator, 'mediaDevices', {
            get: () => undefined
        });

    }, fp);
}

module.exports = {
    getRandomFingerprint,
    applyFingerprint
};
