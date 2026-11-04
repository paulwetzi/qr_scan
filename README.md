# qr_scan – Fahrzeug-Scanner

Web-App zum Erfassen, wo Verkaufsfahrzeuge stehen.

**Ablauf:** Handy an den QR-Code halten → Bildschirm blinkt grün → nächstes Auto. Keine Eingaben, kein Tippen.

Die QR-Aufkleber enthalten einen IMS-Link (`.../api/qr-analyze.php?autoid=…&fgstnr=…`) mit Base64-kodierter Auto-ID und FIN. Die App liest daraus die FIN, nimmt den aktuellen GPS-Standort dazu und speichert alles in ein Google Sheet. Der komplette Link wird mitgespeichert, `php/fahrzeuge.php` liest daraus die Auto-ID. QR-Codes ohne FIN werden mit ihrem Inhalt gespeichert. Dasselbe Auto wird innerhalb von 20 Sekunden nur einmal gespeichert. Ohne Netz bleiben die Scans auf dem Handy und werden automatisch nachgesendet.

## Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Handy-App | `index.html`, `script.js`, `style.css`, `config.js` | Scannen, GPS, senden |
| Google Sheet | `apps-script/Code.gs` | Scans annehmen, Liste als JSON ausgeben |
| IMS-Anbindung | `ims/gps-sync.php` | Standorte aus dem Sheet in `ims.autos_gpsdaten` eintragen |
| IMS-Anzeige | `ims/gps-functions.php`, `ims/gps-luftbild-laden.php`, `ims/ansicht-ausschnitt.php` | Luftbild mit blinkendem Punkt und „Letzter Scan“ |
| Übersicht | `php/fahrzeuge.php` | Liste aus dem Sheet holen und als Tabelle anzeigen |

## Zugriffsschutz (Gerätefreigabe)

Nur freigegebene Geräte können scannen oder die Karte sehen.

1. Neues Handy öffnet die App → Name eingeben → **Freischaltung anfragen**.
2. Im Sheet erscheint im Blatt **Geräte** eine neue Zeile mit dem Namen.
3. Admin setzt in der Spalte **Freigegeben** das Häkchen → die App schaltet sich nach wenigen Sekunden frei.

Häkchen entfernen sperrt das Gerät wieder. Zeile löschen = Gerät muss neu anfragen. Die Geräte-ID wird im Browser des Handys gespeichert. Werden die Browserdaten gelöscht, muss das Handy neu angefragt werden.

Der IMS-Server greift mit `TOKEN` zu (steht nur im Apps Script und in `gps-sync.php`, nicht in der App). Solange dort noch der Platzhalter `HIER-EIN-GEHEIMES-WORT-EINTRAGEN` steht, ist der Abruf per Token gesperrt, weil der Platzhalter öffentlich im Repo steht.

## IMS-Anzeige (Luftbild)

- `ims/gps-functions.php` ersetzt `api/gps-functions.php`: echtes Luftbild statt Zeichnung, gerade gestellt wie der bisherige Plan (um ca. 36° gedreht, gleiche Umrechnung wie `ims/gelaende.php`), blinkender Punkt, darunter „Letzter Scan“. Bestehende Aufrufe funktionieren unverändert. Das Bild kommt genordet vom Landesamt und wird im Browser per CSS gedreht.
- Luftbild: Digitales Orthophoto 20 cm der Bayerischen Vermessungsverwaltung (Open Data, kostenlos, CC BY 4.0 – die Quellenangabe unter dem Bild muss stehen bleiben).
- `ims/gps-luftbild-laden.php` einmal ausführen → speichert das Bild als `api/img/gps-luftbild.jpg` auf dem IMS-Server. Ohne diese Datei lädt der Browser das Bild direkt vom Landesamt.
- `ims/ansicht-ausschnitt.php`: neuer Block für die Fahrzeugansicht (übergibt `autos_gpsdaten.datetime` als „Letzter Scan“). Eine neue Datenbankspalte ist dafür nicht nötig.

## IMS-Anbindung

`ims/gps-sync.php` nach `api/gps-sync.php` im IMS kopieren (neben `update-geolocation.php`), oben `SHEET_TOKEN` und `SCANNER_USERID` eintragen und per Cronjob regelmäßig ausführen:

```
*/5 * * * * php /pfad/zum/ims/api/gps-sync.php >> /var/log/gps-sync.log 2>&1
```

Das Skript holt die Liste aus dem Sheet, liest die Auto-ID aus dem QR-Link und schreibt neue Standorte in `autos_gpsdaten`, genau wie `update-geolocation.php`. Die bestehende Fahrzeugansicht zeigt sie damit automatisch auf der Grundstückskarte. Mehrfaches Ausführen ist unproblematisch, schon eingetragene Scans werden übersprungen. Wie in `update-geolocation.php` werden nur Positionen auf dem Grundstück übernommen (`NUR_GRUNDSTUECK`). Läuft auf PHP 5 mit `mysql_*`.

Im Sheet entstehen zwei Tabellenblätter:
- **Standorte** – eine Zeile pro Fahrzeug mit dem letzten Standort (das ist die Liste „wo steht welches Auto“)
- **Verlauf** – jeder einzelne Scan

## Einrichtung

1. **Google Sheet anlegen** (leer reicht).
2. Im Sheet **Erweiterungen → Apps Script**, Inhalt von `apps-script/Code.gs` einfügen und bei `TOKEN` ein eigenes geheimes Wort eintragen.
3. **Bereitstellen → Neue Bereitstellung → Typ „Web-App“**
   - Ausführen als: **Ich**
   - Zugriff: **Jeder**
   - Die angezeigte URL (endet auf `/exec`) kopieren.
4. In `config.js` die URL bei `sheetUrl` eintragen.
5. In `ims/gps-sync.php` und `php/fahrzeuge.php` dieselbe URL und das geheime Wort eintragen (nur auf dem Server, nicht ins Repo).
6. App über **HTTPS** bereitstellen, z. B. GitHub Pages (Kamera und GPS funktionieren nicht über `file://`).

Nach Änderungen am Apps Script: **Bereitstellungen verwalten → Bearbeiten → Neue Version**, sonst läuft die alte Version weiter.

## Schnittstelle

**Abruf:** `GET <sheetUrl>?token=<token>` (IMS-Server) oder `GET <sheetUrl>?geraet=<geräte-id>` (freigegebenes Gerät, z. B. `karte.html`)

```json
{
  "ok": true,
  "anzahl": 1,
  "fahrzeuge": [
    {
      "fin": "VF7VFEHZ8M7835240",
      "latitude": 48.4171,
      "longitude": 13.3412,
      "genauigkeit": 8,
      "zuletztGescannt": "2026-10-28T13:45:00.000Z",
      "karte": "https://www.google.com/maps?q=48.4171,13.3412",
      "link": "https://www.schuster-gruppe.de/fahrzeuge/VIN_VF7VFEHZ8M7835240_detail"
    }
  ]
}
```

PHP muss Weiterleitungen folgen (`CURLOPT_FOLLOWLOCATION`), weil Google die Antwort umleitet. Siehe `php/fahrzeuge.php`.

## Hinweise

- Die Seite selbst ist über GitHub Pages weiterhin öffentlich aufrufbar, ohne Freigabe kann man damit aber weder scannen noch Standorte sehen.
- Google Sheets reicht locker für einige tausend Scans. Bei sehr vielen Zeilen im Verlauf kann man ältere Zeilen archivieren.

## Geländeplan und Karte

- `ims/gelaende.svg`: vereinfachter Plan des Geländes Rotthofer Straße 10, Ruhstorf, nachgezeichnet aus dem Satellitenbild (952 × 956 px, **nicht genordet**, um ca. −36° gedreht).
- `ims/gelaende.js` und `ims/gelaende.php`: Umrechnung GPS ↔ Pixel im Plan (`gpsZuPixel` / `gelaende_gps_zu_pixel`). Drehung, Maßstab (ca. 5,2 px/m) und Verschiebung wurden aus den Gebäudeecken in OpenStreetMap berechnet, die mittlere Abweichung liegt bei etwa 2 m.
- `karte.html`: zeigt alle Fahrzeuge aus dem Sheet als Punkte im Plan, mit FIN-Suche.
