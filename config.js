// Konfiguration für die Anbindung an das interne System.
// apiUrl leer lassen = Testmodus: Scans werden nur lokal auf dem Gerät gespeichert.
window.QR_SCAN_CONFIG = {
    // Endpunkt, der die Scans per POST (JSON) annimmt, z. B. "https://ims.example.local/api/fahrzeug-standorte"
    apiUrl: "",

    // Optionaler Token, wird als "Authorization: Bearer <token>" mitgeschickt.
    // Achtung: Alles hier ist für jeden sichtbar, der die Seite aufruft.
    apiToken: "",

    // Ab dieser Ungenauigkeit (in Metern) wird gewarnt, bevor gespeichert wird.
    maxAccuracyMeters: 50
};
