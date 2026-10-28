<?php
/*
 * GPS-Sync: Standorte aus dem Google Sheet (Fahrzeug-Scanner) in ims.autos_gpsdaten übernehmen.
 *
 * Ablage:  api/gps-sync.php  (neben update-geolocation.php)
 * Aufruf:  per Cronjob, z. B. alle 5 Minuten:
 *              php /pfad/zum/ims/api/gps-sync.php
 *          oder im Browser als eingeloggter IMS-Benutzer: .../api/gps-sync.php
 *
 * Das Skript ist mehrfach ausführbar: Ein Scan wird nur eingetragen, wenn für diese
 * Auto-ID mit genau diesem Zeitpunkt noch keine Zeile existiert.
 * Läuft auf PHP 5 (mysql_*), wie das restliche IMS.
 */

include dirname(__FILE__) . "/../functions.php";   // stellt die DB-Verbindung her (wie update-geolocation.php)

// ---------- Einstellungen ----------

define('SHEET_URL',   'https://script.google.com/macros/s/AKfycbwWOFG_skftCNEmb-8sf8p37yRHdUvK8Co0Y8nq1sFfEk5A3eDYXupWuUC2jngg2gQL/exec');
define('SHEET_TOKEN', 'HIER-EIN-GEHEIMES-WORT-EINTRAGEN');   // wie TOKEN im Apps Script

// Benutzer-ID, unter der die Scans in autos_gpsdaten.userid eingetragen werden
define('SCANNER_USERID', 0);

// true = wie update-geolocation.php nur Positionen auf dem Grundstück übernehmen
define('NUR_GRUNDSTUECK', true);

// Grenzen des Grundstücks (aus gps-functions.php)
define('GPS_LAT1',  48.430165);
define('GPS_LAT2',  48.428068);
define('GPS_LONG1', 13.321467);
define('GPS_LONG2', 13.324562);

// ---------- Zugriff ----------

$ist_cli = (php_sapi_name() == 'cli');
if (!$ist_cli && !isset($_SESSION['id'])) {
    header('HTTP/1.1 403 Forbidden');
    die('Zugriff verweigert');
}
$nl = $ist_cli ? "\n" : "<br>\n";

// ---------- Hilfsfunktionen ----------

// Auto-ID aus dem QR-Link lesen: ...qr-analyze.php?autoid=<base64>&fgstnr=<base64>
function gps_sync_autoid_aus_link($link) {
    if (!$link) return null;
    $query = parse_url($link, PHP_URL_QUERY);
    if (!$query) return null;
    parse_str($query, $q);
    if (empty($q['autoid'])) return null;
    // parse_str macht aus "+" ein Leerzeichen -> zurückwandeln
    $id = base64_decode(strtr(str_replace(' ', '+', $q['autoid']), '-_', '+/'), true);
    if ($id === false) return null;
    $id = trim($id);
    return ctype_digit($id) ? $id : null;
}

function gps_sync_auf_grundstueck($lat, $lng) {
    return $lat <= GPS_LAT1 && $lat >= GPS_LAT2 && $lng >= GPS_LONG1 && $lng <= GPS_LONG2;
}

// ISO-Zeit (UTC) aus dem Sheet -> lokale Zeit wie im IMS
function gps_sync_zeit($iso) {
    try {
        $d = new DateTime($iso);
        $d->setTimezone(new DateTimeZone('Europe/Berlin'));
        return $d->format('Y-m-d H:i:s');
    } catch (Exception $e) {
        return null;
    }
}

// Zahl ohne Komma-Probleme (setlocale) für SQL formatieren
function gps_sync_zahl($wert) {
    return number_format((float)$wert, 7, '.', '');
}

// ---------- Daten aus dem Sheet holen ----------

$ch = curl_init(SHEET_URL . '?token=' . urlencode(SHEET_TOKEN));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);   // Google leitet die Antwort um
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
$antwort = curl_exec($ch);
$fehler  = curl_error($ch);
curl_close($ch);

if ($antwort === false) {
    die('Sheet nicht erreichbar: ' . $fehler . $nl);
}
$daten = json_decode($antwort, true);
if (!is_array($daten) || empty($daten['ok'])) {
    die('Fehler vom Sheet: ' . (isset($daten['error']) ? $daten['error'] : 'unbekannte Antwort') . $nl);
}

// ---------- In autos_gpsdaten eintragen ----------

$neu = 0;
$schon_da = 0;
$ausserhalb = 0;
$ohne_autoid = 0;
$ohne_gps = 0;

foreach ($daten['fahrzeuge'] as $f) {
    $autoid = gps_sync_autoid_aus_link(isset($f['link']) ? $f['link'] : '');
    if ($autoid === null) { $ohne_autoid++; continue; }

    if (!isset($f['latitude']) || !isset($f['longitude']) || $f['latitude'] === '' || $f['longitude'] === '') {
        $ohne_gps++;
        continue;
    }
    $lat = (float)$f['latitude'];
    $lng = (float)$f['longitude'];

    if (NUR_GRUNDSTUECK && !gps_sync_auf_grundstueck($lat, $lng)) {
        $ausserhalb++;
        continue;
    }

    $zeit = gps_sync_zeit(isset($f['zuletztGescannt']) ? $f['zuletztGescannt'] : '');
    if ($zeit === null) continue;

    $sql = "SELECT 1 FROM `ims`.`autos_gpsdaten` WHERE autoid = " . (int)$autoid .
           " AND `datetime` = '" . mysql_real_escape_string($zeit) . "' LIMIT 1;";
    $res = mysql_query($sql);
    if ($res && mysql_fetch_array($res)) { $schon_da++; continue; }

    $la = gps_sync_zahl($lat);
    $lo = gps_sync_zahl($lng);
    $sql = "INSERT INTO `ims`.`autos_gpsdaten` (`autoid`, `datetime`, `userid`, `latitude_raw`, `longitude_raw`, `coordinates`) " .
           "VALUES ('" . (int)$autoid . "', '" . mysql_real_escape_string($zeit) . "', '" . (int)SCANNER_USERID . "', " .
           "'" . $la . "', '" . $lo . "', POINT(" . $la . ", " . $lo . "));";
    if (mysql_query($sql)) {
        $neu++;
    } else {
        echo 'Fehler bei Auto ' . (int)$autoid . ': ' . mysql_error() . $nl;
    }
}

echo date('Y-m-d H:i:s') . " GPS-Sync: $neu neu, $schon_da schon vorhanden, " .
     "$ausserhalb außerhalb des Grundstücks, $ohne_gps ohne GPS, $ohne_autoid ohne Auto-ID" . $nl;
?>
