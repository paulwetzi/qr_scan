/**
 * Google Apps Script für den Fahrzeug-Scanner.
 *
 * Im Google Sheet: Erweiterungen > Apps Script, diesen Code einfügen,
 * TOKEN setzen, dann Bereitstellen > Neue Bereitstellung > Web-App
 * (Ausführen als: Ich, Zugriff: Jeder).
 *
 * POST  -> nimmt Scans an (vom Handy)
 * GET   -> liefert die Liste aller Fahrzeuge mit letztem Standort als JSON (für PHP)
 *
 * Tabellenblätter werden beim ersten Aufruf automatisch angelegt:
 *   "Standorte" – eine Zeile pro Fahrzeug, immer der letzte Scan
 *   "Verlauf"   – jeder Scan als eigene Zeile
 */

const TOKEN = "HIER-EIN-GEHEIMES-WORT-EINTRAGEN";

const STANDORTE = "Standorte";
const VERLAUF = "Verlauf";
const HEAD_STANDORTE = ["FIN", "Latitude", "Longitude", "Genauigkeit (m)", "Zuletzt gescannt", "Karte", "Link"];
const HEAD_VERLAUF = ["Scan-ID", "FIN", "Latitude", "Longitude", "Genauigkeit (m)", "Gescannt am", "Link"];

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "Ungültige Daten" });
  }
  if (data.token !== TOKEN) return json({ ok: false, error: "Falscher Token" });

  const scans = Array.isArray(data.scans) ? data.scans : [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const verlauf = sheet(VERLAUF, HEAD_VERLAUF);
    const standorte = sheet(STANDORTE, HEAD_STANDORTE);

    // Bereits gespeicherte Scan-IDs (falls das Handy etwas doppelt nachsendet)
    const known = new Set(columnValues(verlauf, 1));

    // FIN -> Zeilennummer + Zeitpunkt in "Standorte"
    const finRows = {};
    const lastRow = standorte.getLastRow();
    if (lastRow > 1) {
      standorte.getRange(2, 1, lastRow - 1, 5).getValues().forEach((r, i) => {
        finRows[r[0]] = { row: i + 2, time: r[4] instanceof Date ? r[4].getTime() : 0 };
      });
    }

    const saved = [];
    scans.forEach((s) => {
      if (!s || !s.id || !s.fin) return;
      const fin = String(s.fin).toUpperCase();
      const time = new Date(s.gescanntAm || Date.now());
      const lat = numOrEmpty(s.latitude);
      const lng = numOrEmpty(s.longitude);
      const acc = numOrEmpty(s.genauigkeit);
      const link = String(s.link || "");

      if (!known.has(s.id)) {
        verlauf.appendRow([s.id, fin, lat, lng, acc, time, link]);
        known.add(s.id);
      }

      // Standort nur übernehmen, wenn GPS vorhanden und der Scan neuer ist
      if (lat !== "" && lng !== "") {
        const map = "https://www.google.com/maps?q=" + lat + "," + lng;
        const rowData = [fin, lat, lng, acc, time, map, link];
        const existing = finRows[fin];
        if (!existing) {
          standorte.appendRow(rowData);
          finRows[fin] = { row: standorte.getLastRow(), time: time.getTime() };
        } else if (time.getTime() >= existing.time) {
          standorte.getRange(existing.row, 1, 1, rowData.length).setValues([rowData]);
          existing.time = time.getTime();
        }
      }
      saved.push(s.id);
    });

    return json({ ok: true, saved: saved });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  if ((e.parameter || {}).token !== TOKEN) return json({ ok: false, error: "Falscher Token" });

  const standorte = sheet(STANDORTE, HEAD_STANDORTE);
  const lastRow = standorte.getLastRow();
  const rows = lastRow > 1 ? standorte.getRange(2, 1, lastRow - 1, HEAD_STANDORTE.length).getValues() : [];

  const fahrzeuge = rows
    .filter((r) => r[0])
    .map((r) => ({
      fin: r[0],
      latitude: r[1] === "" ? null : r[1],
      longitude: r[2] === "" ? null : r[2],
      genauigkeit: r[3] === "" ? null : r[3],
      zuletztGescannt: r[4] instanceof Date ? r[4].toISOString() : r[4],
      karte: r[5],
      link: r[6]
    }));

  return json({ ok: true, anzahl: fahrzeuge.length, fahrzeuge: fahrzeuge });
}

// ---------- Hilfsfunktionen ----------

function sheet(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
  }
  return sh;
}

function columnValues(sh, col) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  return sh.getRange(2, col, lastRow - 1, 1).getValues().map((r) => r[0]);
}

function numOrEmpty(v) {
  return typeof v === "number" && isFinite(v) ? v : "";
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
