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
// Standorte: eine Zeile pro Auto-ID (dieselbe FIN kann im IMS unter mehreren Auto-IDs angelegt sein).
// Codes ohne Auto-ID werden über die FIN geführt.
const HEAD_STANDORTE = ["Auto-ID", "FIN", "Latitude", "Longitude", "Genauigkeit (m)", "Zuletzt gescannt", "Karte", "Link"];
const HEAD_VERLAUF = ["Scan-ID", "FIN", "Latitude", "Longitude", "Genauigkeit (m)", "Gescannt am", "Link", "Gerät", "Auto-ID"];
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

  const standorte = standorteBlatt();
  const lastRow = standorte.getLastRow();
  const rows = lastRow > 1 ? standorte.getRange(2, 1, lastRow - 1, HEAD_STANDORTE.length).getValues() : [];

  const fahrzeuge = rows
    .filter((r) => r[0] !== "" || r[1] !== "")
    .map((r) => ({
      autoId: r[0] === "" ? null : String(r[0]),
      fin: r[1],
      latitude: r[2] === "" ? null : r[2],
      longitude: r[3] === "" ? null : r[3],
      genauigkeit: r[4] === "" ? null : r[4],
      zuletztGescannt: r[5] instanceof Date ? r[5].toISOString() : r[5],
      karte: r[6],
      link: r[7]
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
  const standorte = standorteBlatt();

  // Bereits gespeicherte Scan-IDs (falls das Handy etwas doppelt nachsendet)
  const known = new Set(columnValues(verlauf, 1));

  // Schlüssel (Auto-ID bzw. FIN) -> Zeilennummer + Zeitpunkt in "Standorte"
  const zeilen = standorteIndex(standorte);

  const saved = [];
  scans.forEach((s) => {
    if (!s || !s.id || !s.fin) return;
    const fin = String(s.fin).toUpperCase().slice(0, 300);
    const link = String(s.link || "").slice(0, 500);
    const autoId = gueltigeAutoId(s.autoId) || autoIdAusLink(link) || "";
    const time = new Date(s.gescanntAm || Date.now());
    const lat = numOrEmpty(s.latitude);
    const lng = numOrEmpty(s.longitude);
    const acc = numOrEmpty(s.genauigkeit);

    if (!known.has(s.id)) {
      verlauf.appendRow([s.id, fin, lat, lng, acc, time, link, geraeteName, autoId]);
      known.add(s.id);
    }

    // Standort nur übernehmen, wenn GPS vorhanden und der Scan neuer ist
    if (lat !== "" && lng !== "") {
      setzeStandort(standorte, zeilen, [autoId, fin, lat, lng, acc, time, kartenLink(lat, lng), link]);
    }
    saved.push(s.id);
  });

  return json({ ok: true, saved: saved });
}

function schluessel(autoId, fin) {
  return autoId !== "" && autoId != null ? "ID:" + autoId : "FIN:" + fin;
}

function standorteIndex(sh) {
  const zeilen = {};
  const last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 6).getValues().forEach((r, i) => {
      zeilen[schluessel(r[0], r[1])] = { row: i + 2, time: r[5] instanceof Date ? r[5].getTime() : 0 };
    });
  }
  return zeilen;
}

function setzeStandort(sh, zeilen, rowData) {
  const key = schluessel(rowData[0], rowData[1]);
  const time = rowData[5].getTime();
  const vorhanden = zeilen[key];
  if (!vorhanden) {
    sh.appendRow(rowData);
    zeilen[key] = { row: sh.getLastRow(), time: time };
  } else if (time >= vorhanden.time) {
    sh.getRange(vorhanden.row, 1, 1, rowData.length).setValues([rowData]);
    vorhanden.time = time;
  }
}

function kartenLink(lat, lng) {
  return "https://www.google.com/maps?q=" + lat + "," + lng;
}

// ---------- Auto-ID ----------

function gueltigeAutoId(v) {
  const s = String(v == null ? "" : v).trim();
  return /^\d{1,10}$/.test(s) ? s : null;
}

// IMS-Aufkleber: ...qr-analyze.php?autoid=<base64>&fgstnr=<base64>
function autoIdAusLink(link) {
  const m = String(link || "").match(/[?&]autoid=([^&#]+)/);
  if (!m) return null;
  try {
    let b64 = decodeURIComponent(m[1]).trim().replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const text = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString().trim();
    return gueltigeAutoId(text) || gueltigeAutoId(m[1]);
  } catch (e) {
    return gueltigeAutoId(m[1]);
  }
}

// "Standorte" im neuen Aufbau (Auto-ID in Spalte A). Ein Blatt im alten Aufbau (FIN in Spalte A)
// wird einmalig in "Standorte (alt)" umbenannt und das neue Blatt aus dem Verlauf aufgebaut.
function standorteBlatt() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alt = ss.getSheetByName(STANDORTE);
  if (alt && String(alt.getRange(1, 1).getValue()) !== HEAD_STANDORTE[0]) {
    let name = STANDORTE + " (alt)";
    for (let i = 2; ss.getSheetByName(name); i++) name = STANDORTE + " (alt " + i + ")";
    alt.setName(name);
    const neu = sheet(STANDORTE, HEAD_STANDORTE);
    baueStandorteAusVerlauf(neu);
    return neu;
  }
  return sheet(STANDORTE, HEAD_STANDORTE);
}

function baueStandorteAusVerlauf(standorte) {
  const verlauf = sheet(VERLAUF, HEAD_VERLAUF);
  const last = verlauf.getLastRow();
  if (last < 2) return;
  const neueste = {};
  verlauf.getRange(2, 1, last - 1, HEAD_VERLAUF.length).getValues().forEach((r) => {
    const fin = String(r[1] || "");
    const lat = numOrEmpty(r[2]);
    const lng = numOrEmpty(r[3]);
    if (!fin || lat === "" || lng === "") return;
    const time = r[5] instanceof Date ? r[5] : new Date(r[5]);
    if (isNaN(time.getTime())) return;
    const link = String(r[6] || "");
    const autoId = gueltigeAutoId(r[8]) || autoIdAusLink(link) || "";
    const key = schluessel(autoId, fin);
    if (!neueste[key] || time.getTime() >= neueste[key][5].getTime()) {
      neueste[key] = [autoId, fin, lat, lng, numOrEmpty(r[4]), time, kartenLink(lat, lng), link];
    }
  });
  const rows = Object.keys(neueste).map((k) => neueste[k]);
  if (rows.length) standorte.getRange(2, 1, rows.length, HEAD_STANDORTE.length).setValues(rows);
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
