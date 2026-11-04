// Fahrzeug-Scanner
// Ablauf: Handy hinhalten -> QR erkannt -> grünes Blinken -> nächstes Auto.
// Keine Eingaben nötig. GPS läuft im Hintergrund mit, gespeichert wird ins Google Sheet.

const CONFIG = window.QR_SCAN_CONFIG || {};
const GERAET = window.qrScanGeraet;
const STORAGE_KEY = "qr_scan_scans";
const COOLDOWN_MS = (CONFIG.cooldownSeconds || 20) * 1000;
const FIX_MAX_AGE_MS = 30000;

const $ = (id) => document.getElementById(id);

// ---------- Lokale Ablage (Verlauf + Warteschlange) ----------

function loadScans() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function storeScans() {
    // Gesendete nur die letzten 50 behalten, offene immer
    const pending = scans.filter((s) => !s.sent);
    const sent = scans.filter((s) => s.sent).slice(0, 50);
    scans = [...pending, ...sent].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scans));
    } catch (e) {
        // kein lokaler Speicher verfügbar
    }
}

let scans = loadScans();

// ---------- FIN aus dem QR-Inhalt ----------
// QR-Aufkleber enthalten den IMS-Link mit Base64-kodierter FIN (fgstnr) und Auto-ID (autoid).
// Zusätzlich werden Links wie .../fahrzeuge/VIN_<FIN>_detail und reine FINs erkannt.
// Eine FIN hat 17 Zeichen, ohne I, O und Q.

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

function decodeBase64(value) {
    try {
        let s = String(value).trim().replace(/-/g, "+").replace(/_/g, "/").replace(/ /g, "+");
        while (s.length % 4) s += "=";
        return atob(s).trim();
    } catch (e) {
        return null;
    }
}

// IMS-Aufkleber: .../qr-analyze.php?autoid=<base64>&fgstnr=<base64>
function readImsParams(text) {
    let url;
    try {
        url = new URL(text);
    } catch (e) {
        return null;
    }
    const fg = url.searchParams.get("fgstnr");
    if (!fg) return null;
    let vin = decodeBase64(fg);
    if (!vin || !VIN_RE.test(vin)) vin = VIN_RE.test(fg.trim()) ? fg.trim() : null;
    if (!vin) return null;
    return vin.toUpperCase();
}

// Auto-ID aus dem IMS-Aufkleber (autoid=<base64>), eindeutiger als die FIN:
// dieselbe FIN kann im IMS unter mehreren Auto-IDs angelegt sein.
function extractAutoId(text) {
    let url;
    try {
        url = new URL(text);
    } catch (e) {
        return null;
    }
    const raw = url.searchParams.get("autoid");
    if (!raw) return null;
    const id = decodeBase64(raw);
    if (id && /^\d{1,10}$/.test(id)) return id;
    return /^\d{1,10}$/.test(raw.trim()) ? raw.trim() : null;
}

function extractVin(text) {
    const ims = readImsParams(text);
    if (ims) return ims;
    const fromUrl = text.match(/VIN_([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/i);
    if (fromUrl) return fromUrl[1].toUpperCase();
    const plain = text.match(/(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/i);
    return plain ? plain[1].toUpperCase() : null;
}

// ---------- GPS im Hintergrund ----------

let lastFix = null;

function startGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
        (pos) => { lastFix = pos; },
        () => { /* kein Fix – beim Scan wird erneut versucht */ },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
}

function freshFix() {
    return lastFix && Date.now() - lastFix.timestamp < FIX_MAX_AGE_MS ? lastFix : null;
}

function getFix() {
    const fix = freshFix();
    if (fix) return Promise.resolve(fix);
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => { lastFix = pos; resolve(pos); },
            () => resolve(null),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
    });
}

// ---------- Rückmeldung ----------

let toastTimer = null;

function feedback(text) {
    const flash = $("flash");
    flash.classList.remove("on");
    void flash.offsetWidth; // Animation neu starten
    flash.classList.add("on");

    const toast = $("toast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1500);

    if (navigator.vibrate) navigator.vibrate(120);
}

// ---------- Scannen ----------

const recent = new Map(); // Auto-ID (bzw. FIN) -> Zeitpunkt des letzten Scans

async function onScan(decodedText) {
    const raw = String(decodedText || "").trim();
    if (!raw) return;

    // Auto-ID und FIN aus dem Link; ohne beides dient der QR-Inhalt als Kennung
    const autoid = extractAutoId(raw);
    const vin = extractVin(raw) || raw;
    const key = autoid ? "ID " + autoid : vin;

    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < COOLDOWN_MS) return;
    recent.set(key, now);

    const label = (vin.length > 40 ? vin.slice(0, 40) + "…" : vin) + (autoid ? " · ID " + autoid : "");
    feedback("✓ " + label);

    const scan = {
        id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(now) + "-" + Math.random().toString(36).slice(2),
        vin: vin,
        autoid: autoid,
        link: raw,
        scannedAt: new Date().toISOString(),
        latitude: null,
        longitude: null,
        accuracy: null,
        sent: false
    };
    scans.unshift(scan);
    storeScans();
    render();

    const fix = await getFix();
    if (fix) {
        scan.latitude = fix.coords.latitude;
        scan.longitude = fix.coords.longitude;
        scan.accuracy = Math.round(fix.coords.accuracy);
    }
    storeScans();
    render();
    flush();
}

// ---------- Senden ans Google Sheet ----------

let flushing = false;
let sendError = "";

async function flush() {
    if (flushing || !appUnlocked || !CONFIG.sheetUrl || !navigator.onLine) return;
    // Nur Scans senden, deren GPS-Abfrage abgeschlossen ist (oder die älter als 15 s sind)
    const pending = scans.filter((s) => !s.sent &&
        (s.latitude != null || Date.now() - Date.parse(s.scannedAt) > 15000));
    if (!pending.length) return;

    flushing = true;
    try {
        const res = await fetch(CONFIG.sheetUrl, {
            method: "POST",
            // text/plain vermeidet die CORS-Vorabfrage, die Apps Script nicht beantwortet
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                geraet: GERAET.id,
                scans: pending.map((s) => ({
                    id: s.id,
                    autoId: s.autoid || extractAutoId(s.link) || null,
                    fin: s.vin,
                    link: s.link,
                    latitude: s.latitude,
                    longitude: s.longitude,
                    genauigkeit: s.accuracy,
                    gescanntAm: s.scannedAt
                }))
            })
        });
        const data = await res.json();
        if (data.ok) {
            const saved = new Set(data.saved || pending.map((s) => s.id));
            scans.forEach((s) => { if (saved.has(s.id)) s.sent = true; });
            storeScans();
            sendError = "";
        } else if (data.gesperrt) {
            // Freigabe wurde entzogen: Scanner sperren, Scans bleiben auf dem Gerät
            GERAET.freigegeben = false;
            GERAET.save();
            lockApp();
        } else {
            sendError = data.error || "Sheet hat abgelehnt";
        }
    } catch (e) {
        // offline oder Sheet nicht erreichbar – später erneut
        sendError = navigator.onLine ? "Sheet nicht erreichbar" : "";
    } finally {
        flushing = false;
        render();
    }
}

// ---------- Anzeige ----------

function render() {
    const list = $("history");
    list.textContent = "";

    scans.slice(0, 15).forEach((s) => {
        const li = document.createElement("li");

        const vin = document.createElement("strong");
        vin.textContent = s.vin;
        const aid = s.autoid || extractAutoId(s.link || "");
        if (aid) {
            const idEl = document.createElement("small");
            idEl.className = "autoid";
            idEl.textContent = " ID " + aid;
            vin.appendChild(idEl);
        }

        const time = document.createElement("span");
        time.className = "time";
        time.textContent = new Date(s.scannedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

        const state = document.createElement("span");
        state.className = "dot " + (s.sent ? "ok" : "pending");
        state.title = s.sent ? "im Sheet" : "wird gesendet";

        li.append(state, vin, time);
        list.appendChild(li);
    });

    const today = new Date().toDateString();
    const countToday = scans.filter((s) => new Date(s.scannedAt).toDateString() === today).length;
    const pending = scans.filter((s) => !s.sent).length;

    let text = countToday + (countToday === 1 ? " Auto" : " Autos") + " heute";
    if (!CONFIG.sheetUrl) text += " · nur lokal (kein Sheet eingetragen)";
    else if (pending) text += " · " + pending + " noch nicht gesendet";
    if (sendError && pending) text += " (" + sendError + ")";
    $("info").textContent = text;
}

// ---------- Kamera + Erkennung ----------
// Eigene Kamerasteuerung statt Bibliothek: hohe Auflösung, Dauerfokus,
// Erkennung mit zxing-cpp im Hintergrund-Thread, auf Android zusätzlich
// der eingebaute Scanner des Handys (BarcodeDetector).

const MAX_SIDE = 1920;          // größere Kamerabilder werden verkleinert
const TICK_MS = 60;             // Pause zwischen zwei Bildern

let stream = null;
let video = null;
let canvas = null;
let ctx = null;
let worker = null;
let workerBusy = false;
let workerFailed = false;
let frameNo = 0;
let nativeDetector = null;
let nativeBusy = false;
let loopTimer = null;
let zoomLevels = null;
let zoomIndex = 0;

function setupWorker() {
    try {
        worker = new Worker("scan-worker.js?v=9");
        worker.onmessage = (e) => {
            workerBusy = false;
            if (e.data.text) onScan(e.data.text);
        };
        worker.onerror = () => { workerBusy = false; workerFailed = true; };
    } catch (e) {
        workerFailed = true;
    }
}

async function setupNativeDetector() {
    if (!("BarcodeDetector" in window)) return;
    try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) nativeDetector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch (e) {
        nativeDetector = null;
    }
}

function grabFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
}

function scanTick() {
    loopTimer = null;
    if (!stream || document.hidden) return;

    if (video.readyState >= 2) {
        // 1) Eingebauter Scanner (Android/Chrome), sehr schnell
        if (nativeDetector && !nativeBusy) {
            nativeBusy = true;
            nativeDetector.detect(video)
                .then((codes) => { if (codes.length && codes[0].rawValue) onScan(codes[0].rawValue); })
                .catch(() => {})
                .finally(() => { nativeBusy = false; });
        }

        // 2) zxing-cpp im Worker: abwechselnd ganzes Bild und kontrastverstärkte Bildmitte
        if (worker && !workerBusy && !workerFailed) {
            const img = grabFrame();
            if (img) {
                workerBusy = true;
                frameNo++;
                worker.postMessage(
                    { id: frameNo, width: img.width, height: img.height, buffer: img.data.buffer, mode: frameNo % 2 ? "full" : "center" },
                    [img.data.buffer]
                );
            }
        }
    }
    loopTimer = setTimeout(scanTick, TICK_MS);
}

async function tuneTrack(track) {
    let caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { /* egal */ }

    // Dauerfokus, damit der Code hinter der Scheibe scharf wird
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
        try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (e) { /* egal */ }
    }

    // Zoom-Knopf nur, wenn das Handy Zoom anbietet
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        const min = caps.zoom.min || 1;
        zoomLevels = [min, Math.min(caps.zoom.max, min * 2)];
        if (caps.zoom.max >= min * 3) zoomLevels.push(Math.min(caps.zoom.max, min * 3));
        zoomIndex = 0;
        updateZoomButton();
        $("btn-zoom").hidden = false;
    }
}

function updateZoomButton() {
    if (!zoomLevels) return;
    const base = zoomLevels[0];
    $("btn-zoom").textContent = (zoomLevels[zoomIndex] / base).toFixed(0) + "×";
}

async function toggleZoom() {
    if (!stream || !zoomLevels) return;
    zoomIndex = (zoomIndex + 1) % zoomLevels.length;
    try {
        await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: zoomLevels[zoomIndex] }] });
    } catch (e) { /* egal */ }
    updateZoomButton();
}

function stopCamera() {
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
}

async function startCamera() {
    $("btn-start").hidden = true;
    stopCamera();
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
        video.srcObject = stream;
        await video.play();
        await tuneTrack(stream.getVideoTracks()[0]);
        scanTick();
    } catch (e) {
        stopCamera();
        $("btn-start").hidden = false;
    }
}

// ---------- Gerätefreigabe ----------
// Nur Geräte, die im Sheet (Blatt "Geräte") freigegeben sind, dürfen scannen.

let appUnlocked = false;
let scannerReady = false;
let statusTimer = null;

async function fragGeraetAn(name) {
    const res = await fetch(CONFIG.sheetUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ aktion: "anmelden", geraet: GERAET.id, name: name || GERAET.name })
    });
    return res.json();
}

function showGate(text, showForm) {
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gate-text").textContent = text;
    $("gate-form").hidden = !showForm;
    $("gate-id").textContent = GERAET.id.slice(0, 8);
}

function waitForApproval() {
    showGate("Anfrage gesendet. Warte auf Freigabe …", false);
    clearInterval(statusTimer);
    statusTimer = setInterval(checkStatus, 10000);
}

async function checkStatus() {
    if (!CONFIG.sheetUrl || !navigator.onLine) return;
    try {
        const r = await fragGeraetAn();
        if (r.ok && r.freigegeben) {
            clearInterval(statusTimer);
            GERAET.freigegeben = true;
            if (r.name) GERAET.name = r.name;
            GERAET.save();
            unlockApp();
        } else if (r.ok === false && !GERAET.freigegeben && GERAET.name && /Namen/.test(r.error || "")) {
            // Gerät wurde im Sheet gelöscht -> neu anmelden lassen
            clearInterval(statusTimer);
            GERAET.name = "";
            GERAET.save();
            showGate("Dieses Gerät ist noch nicht freigegeben.", true);
        }
    } catch (e) { /* offline – später erneut */ }
}

async function requestAccess() {
    const name = $("gate-name").value.trim();
    if (!name) { $("gate-name").focus(); return; }
    $("gate-btn").disabled = true;
    try {
        const r = await fragGeraetAn(name);
        if (!r.ok) throw new Error(r.error || "Anfrage fehlgeschlagen");
        GERAET.name = r.name || name;
        GERAET.freigegeben = !!r.freigegeben;
        GERAET.save();
        if (GERAET.freigegeben) unlockApp();
        else waitForApproval();
    } catch (e) {
        $("gate-text").textContent = e.message === "Failed to fetch"
            ? "Keine Verbindung. Bitte mit Internet erneut versuchen."
            : e.message;
    } finally {
        $("gate-btn").disabled = false;
    }
}

function lockApp() {
    appUnlocked = false;
    stopCamera();
    showGate("Dieses Gerät ist nicht (mehr) freigegeben.", false);
    clearInterval(statusTimer);
    statusTimer = setInterval(checkStatus, 30000);
}

async function unlockApp() {
    appUnlocked = true;
    $("gate").hidden = true;
    $("app").hidden = false;

    if (!scannerReady) {
        scannerReady = true;
        render();
        startGps();
        setupWorker();
        await setupNativeDetector();
        window.addEventListener("online", flush);
        setInterval(flush, 20000);
    }
    startCamera();
    flush();
}

document.addEventListener("DOMContentLoaded", () => {
    video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.autoplay = true;
    $("reader").appendChild(video);
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d", { willReadFrequently: true });

    $("btn-start").addEventListener("click", startCamera);
    $("btn-zoom").addEventListener("click", toggleZoom);
    $("gate-btn").addEventListener("click", requestAccess);
    $("gate-name").addEventListener("keydown", (e) => { if (e.key === "Enter") requestAccess(); });

    // Handy gesperrt / App gewechselt: Kamera aus, beim Zurückkommen wieder an
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) stopCamera();
        else if (appUnlocked) startCamera();
    });

    if (GERAET.freigegeben) {
        // Schon freigegeben: sofort scannen (auch offline), Status im Hintergrund prüfen
        unlockApp();
        checkStatusRevoked();
    } else if (GERAET.name) {
        waitForApproval();
        checkStatus();
    } else {
        showGate("Dieses Gerät ist noch nicht freigegeben. Gib deinen Namen ein und frag die Freischaltung an.", true);
    }
});

// Prüft beim Start, ob die Freigabe inzwischen entzogen wurde
async function checkStatusRevoked() {
    if (!CONFIG.sheetUrl || !navigator.onLine) return;
    try {
        const r = await fragGeraetAn();
        if (r.ok && !r.freigegeben) {
            GERAET.freigegeben = false;
            GERAET.save();
            lockApp();
        } else if (!r.ok && /Namen/.test(r.error || "")) {
            // Gerät wurde im Sheet gelöscht
            GERAET.freigegeben = false;
            GERAET.name = "";
            GERAET.save();
            appUnlocked = false;
            stopCamera();
            showGate("Dieses Gerät ist nicht mehr freigegeben. Bitte neu anfragen.", true);
        }
    } catch (e) { /* offline – weiter scannen, Scans werden später gesendet */ }
}
