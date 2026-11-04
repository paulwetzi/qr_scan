<?php
/*
 * Einmalig ausfuehren: laedt das Luftbild des Gelaendes vom Landesamt und speichert es als
 * api/img/gps-luftbild.jpg. Danach kommt das Bild im IMS vom eigenen Server (schneller,
 * funktioniert auch, wenn geoservices.bayern.de mal nicht erreichbar ist).
 *
 * Ablage:  api/gps-luftbild-laden.php  (neben gps-functions.php)
 * Aufruf:  php /pfad/zum/ims/api/gps-luftbild-laden.php
 *          oder als eingeloggter IMS-Benutzer im Browser
 *
 * Neu ausfuehren, wenn sich die Grenzen in gps-functions.php aendern oder ein
 * neueres Luftbild gewuenscht ist (Bayern aktualisiert alle 2-3 Jahre).
 */

include dirname(__FILE__) . "/../functions.php";
require_once dirname(__FILE__) . "/gps-functions.php";

$ist_cli = (php_sapi_name() == 'cli');
if (!$ist_cli && !isset($_SESSION['id'])) {
	header('HTTP/1.1 403 Forbidden');
	die('Zugriff verweigert');
}
$nl = $ist_cli ? "\n" : "<br>\n";

$ordner = dirname(__FILE__) . '/img';
$ziel = $ordner . '/gps-luftbild.jpg';
$url = wt_gps_luftbild_wms_url();   // genordet, wird bei der Anzeige gerade gedreht

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 90);
// Aktuelle Zertifikatsliste (wie bei gps-sync.php), falls die des Servers zu alt ist
$ca = dirname(__FILE__) . '/cacert.pem';
if (is_file($ca)) {
	curl_setopt($ch, CURLOPT_CAINFO, $ca);
}
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
$bild = curl_exec($ch);
$fehler = curl_error($ch);
$typ = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($bild === false) {
	die('Luftbild nicht erreichbar: ' . $fehler . $nl);
}
if ($status != 200 || strpos((string)$typ, 'image/jpeg') !== 0 || strlen($bild) < 20000) {
	die('Unerwartete Antwort vom Landesamt (HTTP ' . $status . ', ' . $typ . '): '
		. htmlspecialchars(substr($bild, 0, 300)) . $nl);
}
if (!is_dir($ordner) && !@mkdir($ordner, 0755)) {
	die('Ordner ' . $ordner . ' fehlt und konnte nicht angelegt werden' . $nl);
}
if (@file_put_contents($ziel, $bild) === false) {
	die('Konnte ' . $ziel . ' nicht schreiben (Schreibrechte?)' . $nl);
}

echo 'Luftbild gespeichert: ' . $ziel . ' (' . round(strlen($bild) / 1024) . ' KB)' . $nl;
?>
