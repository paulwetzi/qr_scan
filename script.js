// Fahrzeug-Scanner
// Ablauf: Handy hinhalten -> QR erkannt -> grünes Blinken -> nächstes Auto.
// Keine Eingaben nötig. GPS läuft im Hintergrund mit, gespeichert wird ins Google Sheet.

const CONFIG = window.QR_SCAN_CONFIG || {};
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
// QR-Codes enthalten Links wie .../fahrzeuge/VIN_VF7VFEHZ8M7835240_detail
// Eine FIN hat 17 Zeichen, ohne I, O und Q.

function extractVin(text) {
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

const recent = new Map(); // FIN -> Zeitpunkt des letzten Scans

async function onScan(decodedText) {
    const raw = String(decodedText || "").trim();
    if (!raw) return;

    // FIN aus dem Link, sonst der ganze QR-Inhalt als Kennung
    const key = extractVin(raw) || raw;

    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < COOLDOWN_MS) return;
    recent.set(key, now);

    feedback("✓ " + (key.length > 40 ? key.slice(0, 40) + "…" : key));

    const scan = {
        id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(now) + "-" + Math.random().toString(36).slice(2),
        vin: key,
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

async function flush() {
    if (flushing || !CONFIG.sheetUrl || !navigator.onLine) return;
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
                token: CONFIG.token,
                scans: pending.map((s) => ({
                    id: s.id,
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
        }
    } catch (e) {
        // offline oder Sheet nicht erreichbar – später erneut
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
    $("info").textContent = text;
}

// ---------- Kamera ----------

let qr = null;

async function startCamera() {
    $("btn-start").hidden = true;
    try {
        await qr.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            onScan,
            () => { /* kein QR im Bild – normal */ }
        );
    } catch (e) {
        $("btn-start").hidden = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    qr = new Html5Qrcode("reader");
    $("btn-start").addEventListener("click", startCamera);

    render();
    startGps();
    startCamera();

    window.addEventListener("online", flush);
    setInterval(flush, 20000);
    flush();
});
