// Konfiguration
window.QR_SCAN_CONFIG = {
    // Web-App-URL des Google Apps Script (endet auf /exec). Leer = nur lokal speichern.
    sheetUrl: "https://script.google.com/macros/s/AKfycbwWOFG_skftCNEmb-8sf8p37yRHdUvK8Co0Y8nq1sFfEk5A3eDYXupWuUC2jngg2gQL/exec",

    // Muss mit TOKEN in apps-script/Code.gs übereinstimmen.
    token: "HIER-EIN-GEHEIMES-WORT-EINTRAGEN",

    // Dasselbe Auto wird innerhalb dieser Zeit nicht nochmal gespeichert (Sekunden).
    cooldownSeconds: 20
};
