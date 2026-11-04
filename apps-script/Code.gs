/**
 * Google Apps Script für den Fahrzeug-Scanner.
 *
 * Im Google Sheet: Erweiterungen > Apps Script, diesen Code einfügen,
 * TOKEN setzen, dann Bereitstellen > Bereitstellungen verwalten > Bearbeiten (Stift)
 * > Version: "Neue Version" > Bereitstellen. Die URL bleibt dabei gleich.
 *
 * Zugriff:
 *   Handys/Tablets   -> nur freigegebene Geräte (Blatt "Geräte", Häkchen in Spalte "Freigegeben")
 *   IMS-Server (PHP) -> mit TOKEN (steht nur hier und in gps-sync.php, nie in der App)
 *
 * POST  {aktion:"anmelden", geraet, name}  -> Gerät meldet sich an bzw. fragt seinen Status ab
 * POST  {geraet, scans:[...]}              -> Scans speichern (nur freigegebene Geräte)
 * GET   ?token=...  oder  ?geraet=...      -> Liste aller Fahrzeuge mit letztem Standort (JSON)
 *
 * Tabellenblätter werden automatisch angelegt:
 *   "Standorte" – eine Zeile pro Fahrzeug, immer der letzte Scan
 *   "Verlauf"   – jeder Scan als eigene Zeile
 *   "Geräte"    – angemeldete Geräte, Freigabe per Häkchen
 */

// Geheimes Wort für den IMS-Server. Muss ein eigenes Wort sein und mit
// SHEET_TOKEN in gps-sync.php übereinstimmen. Nicht in config.js eintragen!
const TOKEN = "HIER-EIN-GEHEIMES-WORT-EINTRAGEN";

const STANDORTE = "Standorte";
const VERLAUF = "Verlauf";
const GERAETE = "Geräte";
const HEAD_STANDORTE = ["FIN", "Latitude", "Longitude", "Genauigkeit (m)", "Zuletzt gescannt", "Karte", "Link"];
const HEAD_VERLAUF = ["Scan-ID", "FIN", "Latitude", "Longitude", "Genauigkeit (m)", "Gescannt am", "Link", "Gerät"];
const HEAD_GERAETE = ["Geräte-ID", "Name", "Angefragt am", "Freigegeben", "Zuletzt aktiv"];

const MAX_OFFENE_ANFRAGEN = 30;   // Schutz gegen massenhaft Anmeldungen

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "Ungültige Daten" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (data.aktion === "anmelden") return anmelden(data);

    const geraet = findeGeraet(data.geraet);
    if (!geraet || !geraet.freigegeben) {
      return json({ ok: false, gesperrt: true, error: "Gerät nicht freigegeben" });
    }
    merkeAktivitaet(geraet);
    return speichereScans(Array.isArray(data.scans) ? data.scans : [], geraet.name);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const p = e.parameter || {};
  const perToken = TOKEN && p.token === TOKEN && TOKEN !== "HIER-EIN-GEHEIMES-WORT-EINTRAGEN";
  if (!perToken) {
    const geraet = findeGeraet(p.geraet);
    if (!geraet || !geraet.freigegeben) {
      return json({ ok: false, gesperrt: true, error: "Kein Zugriff" });
    }
  }

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

// ---------- Geräte ----------

function anmelden(data) {
  const id = gueltigeId(data.geraet);
  if (!id) return json({ ok: false, error: "Ungültige Geräte-ID" });

  const vorhanden = findeGeraet(id);
  if (vorhanden) {
    if (vorhanden.freigegeben) merkeAktivitaet(vorhanden);
    return json({ ok: true, freigegeben: vorhanden.freigegeben, name: vorhanden.name });
  }

  const name = String(data.name || "").trim().slice(0, 60);
  if (!name) return json({ ok: false, error: "Bitte einen Namen angeben" });

  const sh = sheet(GERAETE, HEAD_GERAETE);
  const offen = sh.getLastRow() > 1
    ? sh.getRange(2, 4, sh.getLastRow() - 1, 1).getValues().filter((r) => !istJa(r[0])).length
    : 0;
  if (offen >= MAX_OFFENE_ANFRAGEN) {
    return json({ ok: false, error: "Zu viele offene Anfragen – bitte beim Admin melden" });
  }

  sh.appendRow([id, name, new Date(), false, ""]);
  sh.getRange(sh.getLastRow(), 4).insertCheckboxes();
  return json({ ok: true, freigegeben: false, name: name });
}

function findeGeraet(rawId) {
  const id = gueltigeId(rawId);
  if (!id) return null;
  const sh = sheet(GERAETE, HEAD_GERAETE);
  const last = sh.getLastRow();
  if (last < 2) return null;
  const rows = sh.getRange(2, 1, last - 1, 4).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      return { row: i + 2, id: id, name: String(rows[i][1] || ""), freigegeben: istJa(rows[i][3]) };
    }
  }
  return null;
}

function merkeAktivitaet(geraet) {
  sheet(GERAETE, HEAD_GERAETE).getRange(geraet.row, 5).setValue(new Date());
}

function gueltigeId(v) {
  const s = String(v || "").trim();
  return /^[A-Za-z0-9-]{20,64}$/.test(s) ? s : null;
}

function istJa(v) {
  return v === true || /^(ja|x|true|1)$/i.test(String(v).trim());
}

// ---------- Scans ----------

function speichereScans(scans, geraeteName) {
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
    const fin = String(s.fin).toUpperCase().slice(0, 300);
    const time = new Date(s.gescanntAm || Date.now());
    const lat = numOrEmpty(s.latitude);
    const lng = numOrEmpty(s.longitude);
    const acc = numOrEmpty(s.genauigkeit);
    const link = String(s.link || "").slice(0, 500);

    if (!known.has(s.id)) {
      verlauf.appendRow([s.id, fin, lat, lng, acc, time, link, geraeteName]);
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
  } else if (sh.getLastColumn() < header.length) {
    // neue Spalte(n) in bestehendem Blatt ergänzen (z. B. "Gerät" im Verlauf)
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
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
