// QR-Erkennung im Hintergrund-Thread (zxing-cpp als WebAssembly).
// Deutlich robuster als die alte Bibliothek bei Spiegelungen, wenig Kontrast
// und kleinen Codes hinter der Windschutzscheibe.

importScripts("lib/zxing-reader.js?v=7");

ZXingWASM.prepareZXingModule({
    overrides: {
        locateFile: (path, prefix) =>
            path.endsWith(".wasm") ? new URL("lib/zxing_reader.wasm?v=7", self.location.href).href : prefix + path
    },
    fireImmediately: true
});

const OPTIONS = {
    formats: ["QRCode"],
    tryHarder: true,
    tryInvert: true,
    tryRotate: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1
};

// Mittelausschnitt + lokale Kontrastdehnung: zieht Spiegelungen und
// Grauschleier der Scheibe ab, damit schwache Codes wieder schwarz/weiß werden.
function enhanceCenter(img, frac) {
    const { data, width: W, height: H } = img;
    const cw = Math.round(W * frac), ch = Math.round(H * frac);
    const ox = (W - cw) >> 1, oy = (H - ch) >> 1;

    const g = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const i = ((y + oy) * W + x + ox) * 4;
            g[y * cw + x] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
        }
    }

    const T = 32, gx = Math.ceil(cw / T), gy = Math.ceil(ch / T);
    const mn = new Float32Array(gx * gy).fill(255), mx = new Float32Array(gx * gy);
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const k = ((y / T) | 0) * gx + ((x / T) | 0), v = g[y * cw + x];
            if (v < mn[k]) mn[k] = v;
            if (v > mx[k]) mx[k] = v;
        }
    }

    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
        const fy = Math.min(Math.max(y / T - 0.5, 0), gy - 1), y0 = fy | 0, y1 = Math.min(y0 + 1, gy - 1), ay = fy - y0;
        for (let x = 0; x < cw; x++) {
            const fx = Math.min(Math.max(x / T - 0.5, 0), gx - 1), x0 = fx | 0, x1 = Math.min(x0 + 1, gx - 1), ax = fx - x0;
            const lerp = (a) => (a[y0 * gx + x0] * (1 - ax) + a[y0 * gx + x1] * ax) * (1 - ay) +
                                (a[y1 * gx + x0] * (1 - ax) + a[y1 * gx + x1] * ax) * ay;
            const lo = lerp(mn), hi = lerp(mx);
            const v = (g[y * cw + x] - lo) / Math.max(hi - lo, 12) * 255;
            const i = (y * cw + x) * 4;
            out[i] = out[i + 1] = out[i + 2] = v;
            out[i + 3] = 255;
        }
    }
    return new ImageData(out, cw, ch);
}

self.onmessage = async (e) => {
    const { id, width, height, buffer, mode } = e.data;
    let text = null;
    try {
        let img = new ImageData(new Uint8ClampedArray(buffer), width, height);
        if (mode === "center") img = enhanceCenter(img, 0.6);
        const results = await ZXingWASM.readBarcodes(img, OPTIONS);
        const hit = results.find((r) => r.isValid && r.text);
        if (hit) text = hit.text;
    } catch (err) {
        self.postMessage({ id, text: null, error: String(err) });
        return;
    }
    self.postMessage({ id, text });
};
