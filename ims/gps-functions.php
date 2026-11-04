<?php
/*
 * GPS-Anzeige im IMS: echtes Luftbild des Gelaendes, gerade gestellt wie der bisherige
 * Plan, mit blinkendem Punkt und "Letzter Scan".
 *
 * Ersetzt api/gps-functions.php. Bestehende Aufrufe funktionieren weiter:
 *   wt_display_auto_gps($breite, $hoehe, $lat, $lon, $debug, $relativeurl [, $letzterscan])
 *   $letzterscan = Zeitpunkt aus autos_gpsdaten.datetime (optional)
 *
 * Luftbild: Digitales Orthophoto 20 cm (DOP20) der Bayerischen Vermessungsverwaltung,
 * Open Data, Lizenz CC BY 4.0 -> die Quellenangabe unter dem Bild muss bleiben.
 * Das Bild kommt genordet vom Landesamt und wird im Browser per CSS um ca. 36 Grad
 * gedreht, damit die Gebaeude gerade stehen (gleiche Ausrichtung wie der alte Plan).
 * Liegt api/img/gps-luftbild.jpg vor (siehe gps-luftbild-laden.php), wird diese Datei
 * verwendet, sonst laedt der Browser das Bild direkt vom Landesamt.
 *
 * Laeuft auf PHP 5. Ausgabe nur mit HTML-Entities, passt zu iso-8859-1.
 */

// ---------- Geraderichtung (gleiche Werte wie ims/gelaende.php) ----------
// Plan: 952 x 956 Pixel, um -36.4 Grad gedreht, ca. 5,1 Pixel pro Meter.
// Ermittelt aus den Gebaeudeecken in OpenStreetMap, mittlere Abweichung ca. 2 m.
if (!defined('WT_PLAN_BREITE')) {
	define('WT_PLAN_BREITE', 952);
	define('WT_PLAN_HOEHE', 956);
	define('WT_PLAN_LAT0', 48.429);
	define('WT_PLAN_LON0', 13.3225);
	define('WT_PLAN_MX', 73866.1225);   // Meter pro Grad Laenge
	define('WT_PLAN_MY', 111320.0);     // Meter pro Grad Breite
	define('WT_PLAN_A', 4.129406);
	define('WT_PLAN_B', -3.040997);
	define('WT_PLAN_C', 361.1014);
	define('WT_PLAN_D', 396.3646);
	define('WT_LUFTBILD_PX_PRO_M', 5.2);
}

// GPS -> Pixel im geraden Plan (x nach rechts, y nach unten)
function wt_gps_zu_plan($lat, $lon) {
	$x = ($lon - WT_PLAN_LON0) * WT_PLAN_MX;
	$y = ($lat - WT_PLAN_LAT0) * WT_PLAN_MY;
	return array(
		'x' => WT_PLAN_A * $x - WT_PLAN_B * $y + WT_PLAN_C,
		'y' => -WT_PLAN_B * $x - WT_PLAN_A * $y + WT_PLAN_D
	);
}

// Pixel im geraden Plan -> GPS
function wt_plan_zu_gps($px, $py) {
	$u = $px - WT_PLAN_C;
	$v = $py - WT_PLAN_D;
	$n = WT_PLAN_A * WT_PLAN_A + WT_PLAN_B * WT_PLAN_B;
	$x = (WT_PLAN_A * $u - WT_PLAN_B * $v) / $n;
	$y = (-WT_PLAN_B * $u - WT_PLAN_A * $v) / $n;
	return array('lat' => WT_PLAN_LAT0 + $y / WT_PLAN_MY, 'lon' => WT_PLAN_LON0 + $x / WT_PLAN_MX);
}

function wt_gps_im_plan($p) {
	return $p['x'] >= 0 && $p['y'] >= 0 && $p['x'] <= WT_PLAN_BREITE && $p['y'] <= WT_PLAN_HOEHE;
}

// Genordeter Ausschnitt, der den ganzen (gedrehten) Plan abdeckt, plus 2 m Rand
function wt_gps_luftbild_ausschnitt() {
	static $a = null;
	if ($a !== null) return $a;
	$lats = array();
	$lons = array();
	foreach (array(array(0, 0), array(WT_PLAN_BREITE, 0), array(WT_PLAN_BREITE, WT_PLAN_HOEHE), array(0, WT_PLAN_HOEHE)) as $e) {
		$g = wt_plan_zu_gps($e[0], $e[1]);
		$lats[] = $g['lat'];
		$lons[] = $g['lon'];
	}
	$rlat = 2 / WT_PLAN_MY;
	$rlon = 2 / WT_PLAN_MX;
	$a = array(
		'latmin' => round(min($lats) - $rlat, 6),
		'latmax' => round(max($lats) + $rlat, 6),
		'lonmin' => round(min($lons) - $rlon, 6),
		'lonmax' => round(max($lons) + $rlon, 6)
	);
	$a['breite'] = (int)round(($a['lonmax'] - $a['lonmin']) * WT_PLAN_MX * WT_LUFTBILD_PX_PRO_M);
	$a['hoehe']  = (int)round(($a['latmax'] - $a['latmin']) * WT_PLAN_MY * WT_LUFTBILD_PX_PRO_M);
	return $a;
}

// Zahl immer mit Punkt (unabhaengig von setlocale)
function wt_gps_zahl($wert, $stellen = 6) {
	return number_format((float)$wert, $stellen, '.', '');
}

// Adresse des genordeten Luftbilds beim Landesamt (WMS)
function wt_gps_luftbild_wms_url() {
	$a = wt_gps_luftbild_ausschnitt();
	return 'https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
		. '&LAYERS=by_dop20c&STYLES=&CRS=EPSG:4326'
		// WMS 1.3.0 mit EPSG:4326: Reihenfolge Breite,Laenge
		. '&BBOX=' . wt_gps_zahl($a['latmin']) . ',' . wt_gps_zahl($a['lonmin']) . ','
		. wt_gps_zahl($a['latmax']) . ',' . wt_gps_zahl($a['lonmax'])
		. '&WIDTH=' . $a['breite'] . '&HEIGHT=' . $a['hoehe'] . '&FORMAT=image/jpeg';
}

function wt_gps_luftbild_src($wtrelativeurl) {
	if (is_file(dirname(__FILE__) . '/img/gps-luftbild.jpg')) {
		return $wtrelativeurl . 'img/gps-luftbild.jpg';
	}
	return wt_gps_luftbild_wms_url();
}

// CSS-Matrix: Pixel im genordeten Luftbild -> Pixel in der Anzeige (gerade gestellt)
function wt_gps_luftbild_css_matrix($sx, $sy) {
	$a = wt_gps_luftbild_ausschnitt();
	$dEu = ($a['lonmax'] - $a['lonmin']) / $a['breite'] * WT_PLAN_MX;   // Meter Ost pro Bildpixel
	$dNv = -($a['latmax'] - $a['latmin']) / $a['hoehe'] * WT_PLAN_MY;   // Meter Nord pro Bildpixel
	$e0 = ($a['lonmin'] - WT_PLAN_LON0) * WT_PLAN_MX;
	$n0 = ($a['latmax'] - WT_PLAN_LAT0) * WT_PLAN_MY;
	$m = array(
		$sx * WT_PLAN_A * $dEu,
		$sy * -WT_PLAN_B * $dEu,
		$sx * -WT_PLAN_B * $dNv,
		$sy * -WT_PLAN_A * $dNv,
		$sx * (WT_PLAN_A * $e0 - WT_PLAN_B * $n0 + WT_PLAN_C),
		$sy * (-WT_PLAN_B * $e0 - WT_PLAN_A * $n0 + WT_PLAN_D)
	);
	$teile = array();
	foreach ($m as $wert) $teile[] = wt_gps_zahl($wert, 6);
	return 'matrix(' . implode(',', $teile) . ')';
}

// "Letzter Scan: 04.11.2026, 09:15 Uhr (vor 3 Tagen)"
function wt_gps_letzter_scan_text($wtletzterscan) {
	if ($wtletzterscan == '') return '';
	$ts = strtotime($wtletzterscan);
	if (!$ts) return '';

	$tage = (int)floor((strtotime(date('Y-m-d')) - strtotime(date('Y-m-d', $ts))) / 86400);
	if ($tage <= 0)      $alter = 'heute';
	else if ($tage == 1) $alter = 'gestern';
	else                 $alter = 'vor ' . $tage . ' Tagen';

	return '<b>Letzter Scan:</b> ' . date('d.m.Y', $ts) . ', ' . date('H:i', $ts) . ' Uhr (' . $alter . ')';
}

function wt_gps_css() {
	static $ausgegeben = false;
	if ($ausgegeben) return;
	$ausgegeben = true;
	echo '<style type="text/css">
.wtgps { position: relative; border: 1px solid grey; overflow: hidden; background: #ddd; }
.wtgps img { position: absolute; left: 0; top: 0; max-width: none; border: 0;
	-webkit-transform-origin: 0 0; -ms-transform-origin: 0 0; transform-origin: 0 0; }
.wtgps-punkt { position: absolute; width: 16px; height: 16px; margin: -10px 0 0 -10px;
	border-radius: 50%; background: #e00000; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,.7);
	-webkit-animation: wtgps-blink 1s ease-in-out infinite; animation: wtgps-blink 1s ease-in-out infinite; }
.wtgps-punkt:after { content: ""; position: absolute; left: -2px; top: -2px; width: 16px; height: 16px;
	border-radius: 50%; border: 2px solid #ff2020;
	-webkit-animation: wtgps-ring 1.5s ease-out infinite; animation: wtgps-ring 1.5s ease-out infinite; }
@-webkit-keyframes wtgps-blink { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }
@keyframes wtgps-blink { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }
@-webkit-keyframes wtgps-ring { 0% { -webkit-transform: scale(1); opacity: .9; } 100% { -webkit-transform: scale(3.5); opacity: 0; } }
@keyframes wtgps-ring { 0% { transform: scale(1); opacity: .9; } 100% { transform: scale(3.5); opacity: 0; } }
.wtgps-info { margin-top: 6px; font-family: Tahoma, Arial, sans-serif; font-size: 13px; }
.wtgps-quelle { margin-top: 2px; font-family: Arial, sans-serif; font-size: 10px; color: #888; }
</style>';
}

function wt_display_auto_gps($wtgpsmapwidth, $wtgpsmapheight, $wtlatitude, $wtlongitude, $wtdebug = 0, $wtrelativeurl = '', $wtletzterscan = '') {

	$p = null;

	// gps-Daten auf plausi checken (innerhalb des Gelaendes)
	if (($wtlatitude != '') && ($wtlongitude != '')) {
		$p = wt_gps_zu_plan((float)$wtlatitude, (float)$wtlongitude);
		if (!wt_gps_im_plan($p)) {
			// Debug: Punkt in die Mitte setzen, sonst nicht anzeigen
			$p = ($wtdebug == 1) ? array('x' => WT_PLAN_BREITE / 2, 'y' => WT_PLAN_HOEHE / 2) : null;
		}
	}

	wt_gps_css();
	$scantext = wt_gps_letzter_scan_text($wtletzterscan);

	if ($p === null) {
		if ($scantext != '') {
			echo '<div class="wtgps-info">' . $scantext . ' &ndash; Position au&szlig;erhalb des Gel&auml;ndes</div>';
		}
		return false;
	}

	$sx = $wtgpsmapwidth / WT_PLAN_BREITE;
	$sy = $wtgpsmapheight / WT_PLAN_HOEHE;
	$a = wt_gps_luftbild_ausschnitt();
	$matrix = wt_gps_luftbild_css_matrix($sx, $sy);
	$src = htmlspecialchars(wt_gps_luftbild_src($wtrelativeurl), ENT_QUOTES);

	echo '<div class="wtgps" style="width:' . (int)$wtgpsmapwidth . 'px;height:' . (int)$wtgpsmapheight . 'px;">';
	echo '<img src="' . $src . '" width="' . $a['breite'] . '" height="' . $a['hoehe'] . '" alt="Luftbild Gel&auml;nde"'
		. ' style="-webkit-transform:' . $matrix . ';-ms-transform:' . $matrix . ';transform:' . $matrix . ';">';
	echo '<span class="wtgps-punkt" style="left:' . round($p['x'] * $sx) . 'px;top:' . round($p['y'] * $sy) . 'px;"></span>';
	echo '</div>';
	if ($scantext != '') {
		echo '<div class="wtgps-info">' . $scantext . '</div>';
	}
	echo '<div class="wtgps-quelle">Luftbild: &copy; Bayerische Vermessungsverwaltung &ndash; www.geodaten.bayern.de, CC BY 4.0</div>';

	return true;
}	// function wt_display_auto_gps
?>
