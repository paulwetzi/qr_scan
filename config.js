// Konfiguration
window.QR_SCAN_CONFIG = {
    // Web-App-URL des Google Apps Script (endet auf /exec). Leer = nur lokal speichern.
    sheetUrl: "https://script.google.com/macros/s/AKfycbwWOFG_skftCNEmb-8sf8p37yRHdUvK8Co0Y8nq1sFfEk5A3eDYXupWuUC2jngg2gQL/exec",

    // Kein Token mehr hier: Zugriff haben nur Geräte, die im Sheet (Blatt "Geräte") freigegeben sind.

    // Dasselbe Auto wird innerhalb dieser Zeit nicht nochmal gespeichert (Sekunden).
    cooldownSeconds: 20
};

// Geräte-ID dieses Handys (wird beim ersten Öffnen erzeugt und bleibt im Browser gespeichert).
// Wird von script.js und karte.html gemeinsam genutzt.
window.qrScanGeraet = (function () {
    const KEY = "qr_scan_geraet";
    let g = null;
    try { g = JSON.parse(localStorage.getItem(KEY)); } catch (e) { g = null; }
    if (!g || !g.id) {
        const id = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
        g = { id: id, name: "", freigegeben: false };
    }
    g.save = function () {
        try { localStorage.setItem(KEY, JSON.stringify({ id: g.id, name: g.name, freigegeben: g.freigegeben })); } catch (e) { /* egal */ }
    };
    g.save();
    return g;
})();
