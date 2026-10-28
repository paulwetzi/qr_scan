// Fahrzeug-Scanner: QR-Code scannen, Standort erfassen, ans interne System senden.

const CONFIG = window.QR_SCAN_CONFIG || {};
const STORAGE_KEY = "qr_scan_scans";
const HISTORY_LIMIT = 20;

const $ = (id) => document.getElementById(id);

// ---------- Lokale Ablage (Verlauf + Warteschlange für offline) ----------

function loadScans() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function saveScans(scans) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scans.slice(0, 200)));
    } catch (e) {
        // Speicher nicht verfügbar (z. B. privater Modus) – dann eben nur im Speicher
    }
}

let scans = loadScans();

// ---------- Senden ----------

async function sendScan(scan) {
    if (!CONFIG.apiUrl) {
        return { ok: false, reason: "Kein Server konfiguriert (Testmodus)" };
    }
    const headers = { "Content-Type": "application/json" };
    if (CONFIG.apiToken) headers["Authorization"] = "Bearer " + CONFIG.apiToken;

    const payload = {
        id: scan.id,
        fahrzeugCode: scan.code,
        latitude: scan.latitude,
        longitude: scan.longitude,
        genauigkeitMeter: scan.accuracy,
        notiz: scan.note,
        gescanntAm: scan.scannedAt
    };

    try {
        const res = await fetch(CONFIG.apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });
        if (!res.ok) return { ok: false, reason: "Server antwortet " + res.status };
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: "Keine Verbindung" };
    }
}

async function resendPending() {
    const pending = scans.filter((s) => !s.sent);
    for (const scan of pending) {
        const r = await sendScan(scan);
        if (r.ok) scan.sent = true;
        else scan.error = r.reason;
    }
    saveScans(scans);
    renderHistory();
}

// ---------- Standort ----------

function getPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Dieser Browser kann keinen Standort ermitteln."));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            resolve,
            (err) => {
                const messages = {
                    1: "Standortzugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben.",
                    2: "Standort nicht verfügbar. GPS aktiv?",
                    3: "Standort hat zu lange gedauert. Bitte erneut versuchen."
                };
                reject(new Error(messages[err.code] || "Standort konnte nicht ermittelt werden."));
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    });
}

// ---------- Ablauf eines Scans ----------

let current = null;
let scanner = null;

function setStatus(text, type) {
    const el = $("status");
    el.textContent = text || "";
    el.className = "status" + (type ? " " + type : "");
}

async function locateCurrent() {
    $("btn-save").disabled = true;
    $("r-pos").textContent = "wird ermittelt …";
    $("r-acc").textContent = "–";
    $("r-warn").hidden = true;

    try {
        const pos = await getPosition();
        if (!current) return; // inzwischen verworfen
        current.latitude = pos.coords.latitude;
        current.longitude = pos.coords.longitude;
        current.accuracy = Math.round(pos.coords.accuracy);

        $("r-pos").textContent = current.latitude.toFixed(6) + ", " + current.longitude.toFixed(6);
        $("r-acc").textContent = "± " + current.accuracy + " m";

        const max = CONFIG.maxAccuracyMeters || 50;
        if (current.accuracy > max) {
            $("r-warn").textContent = "Standort ist ungenau. Am besten kurz warten und „Standort neu“ tippen.";
            $("r-warn").hidden = false;
        }
        $("btn-save").disabled = false;
    } catch (e) {
        $("r-pos").textContent = "nicht verfügbar";
        $("r-warn").textContent = e.message;
        $("r-warn").hidden = false;
    }
}

function onScanSuccess(decodedText) {
    if (current) return; // es läuft schon ein Scan
    scanner.pause(true);

    current = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
        code: decodedText.trim(),
        scannedAt: new Date().toISOString(),
        note: "",
        sent: false
    };

    $("r-code").textContent = current.code;
    $("r-note").value = "";
    $("result").hidden = false;
    setStatus("");
    if (navigator.vibrate) navigator.vibrate(100);

    locateCurrent();
}

function resetScan() {
    current = null;
    $("result").hidden = true;
    try {
        scanner.resume();
    } catch (e) {
        // Scanner war nicht pausiert
    }
}

async function saveCurrent() {
    if (!current || current.latitude == null) return;
    current.note = $("r-note").value.trim();
    $("btn-save").disabled = true;
    setStatus("Wird gesendet …");

    const scan = current;
    const r = await sendScan(scan);
    scan.sent = r.ok;
    if (!r.ok) scan.error = r.reason;

    scans.unshift(scan);
    saveScans(scans);
    renderHistory();

    if (r.ok) setStatus("Gespeichert: " + scan.code, "ok");
    else setStatus("Lokal gespeichert, wird nachgesendet (" + r.reason + ")", "warn");

    resetScan();
}

// ---------- Verlauf ----------

function renderHistory() {
    const list = $("history");
    list.textContent = "";

    scans.slice(0, HISTORY_LIMIT).forEach((s) => {
        const li = document.createElement("li");

        const title = document.createElement("strong");
        title.textContent = s.code;

        const info = document.createElement("span");
        const time = new Date(s.scannedAt).toLocaleString("de-DE", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
        });
        info.textContent = time + (s.note ? " · " + s.note : "");

        const map = document.createElement("a");
        map.href = "https://www.google.com/maps?q=" + s.latitude + "," + s.longitude;
        map.target = "_blank";
        map.rel = "noopener";
        map.textContent = "Karte";

        const badge = document.createElement("span");
        badge.className = "badge " + (s.sent ? "ok" : "pending");
        badge.textContent = s.sent ? "gesendet" : "offen";

        li.append(title, badge, info, map);
        list.appendChild(li);
    });

    if (!scans.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "Noch keine Scans.";
        list.appendChild(li);
    }

    const pendingCount = scans.filter((s) => !s.sent).length;
    $("btn-resend").hidden = pendingCount === 0 || !CONFIG.apiUrl;
    $("btn-resend").textContent = "Offene senden (" + pendingCount + ")";
}

// ---------- Start ----------

document.addEventListener("DOMContentLoaded", () => {
    $("btn-save").addEventListener("click", saveCurrent);
    $("btn-cancel").addEventListener("click", resetScan);
    $("btn-retry-pos").addEventListener("click", locateCurrent);
    $("btn-resend").addEventListener("click", resendPending);

    if (!CONFIG.apiUrl) {
        setStatus("Testmodus: kein Server eingetragen, Scans bleiben auf dem Gerät.", "warn");
    }

    scanner = new Html5QrcodeScanner("my-qr-reader", {
        fps: 10,
        qrbox: 250,
        rememberLastUsedCamera: true
    });
    scanner.render(onScanSuccess);

    renderHistory();

    // Offene Scans automatisch nachsenden, sobald wieder Netz da ist
    window.addEventListener("online", resendPending);
    if (navigator.onLine) resendPending();
});
