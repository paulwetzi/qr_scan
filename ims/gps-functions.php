<?php
/*
 * GPS-Anzeige im IMS: echtes Luftbild des Gelaendes, blinkender Punkt, "Letzter Scan".
 *
 * Ersetzt api/gps-functions.php. Bestehende Aufrufe funktionieren weiter:
 *   wt_display_auto_gps($breite, $hoehe, $lat, $lon, $debug, $relativeurl [, $letzterscan])
 *   $letzterscan = Zeitpunkt aus autos_gpsdaten.datetime (optional)
 *
 * Luftbild: Digitales Orthophoto 20 cm (DOP20) der Bayerischen Vermessungsverwaltung,
 * Open Data, Lizenz CC BY 4.0 -> die Quellenangabe unter dem Bild muss bleiben.
 * Liegt api/img/gps-luftbild.jpg vor (siehe gps-luftbild-laden.php), wird diese Datei
 * verwendet, sonst laedt der Browser das Bild direkt vom Landesamt.
 *
 * Laeuft auf PHP 5. Ausgabe nur mit HTML-Entities, passt zu iso-8859-1.
 */

// Grenzen des Gelaendes = Ausschnitt des Luftbilds (Norden oben)
if (!defined('WT_GPS_LAT1')) {
	define('WT_GPS_LAT1',  48.430165);   // Nordrand
	define('WT_GPS_LAT2',  48.428068);   // Suedrand
	define('WT_GPS_LONG1', 13.321467);   // Westrand
	define('WT_GPS_LONG2', 13.324562);   // Ostrand
}

// Adresse des Luftbilds beim Landesamt (WMS) fuer genau diesen Ausschnitt
function wt_gps_luftbild_wms_url($breite, $hoehe) {
	$f = 'wt_gps_zahl';
	return 'https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
		. '&LAYERS=by_dop20c&STYLES=&CRS=EPSG:4326'
		// WMS 1.3.0 mit EPSG:4326: Reihenfolge Breite,Laenge
		. '&BBOX=' . $f(WT_GPS_LAT2) . ',' . $f(WT_GPS_LONG1) . ',' . $f(WT_GPS_LAT1) . ',' . $f(WT_GPS_LONG2)
		. '&WIDTH=' . (int)$breite . '&HEIGHT=' . (int)$hoehe . '&FORMAT=image/jpeg';
}

// Zahl immer mit Punkt (unabhaengig von setlocale)
function wt_gps_zahl($wert) {
	return number_format((float)$wert, 6, '.', '');
}

function wt_gps_luftbild_src($wtrelativeurl) {
	if (is_file(dirname(__FILE__) . '/img/gps-luftbild.jpg')) {
		return $wtrelativeurl . 'img/gps-luftbild.jpg';
	}
	return wt_gps_luftbild_wms_url(1172, 1185);
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
.wtgps img { display: block; }
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

	$wt_lat_ok = 0;
	$wt_long_ok = 0;

	// gps-Daten auf plausi checken (innerhalb des Luftbilds)
	if (($wtlatitude != '') && ($wtlongitude != '')) {
		$wtlatitude = (float)$wtlatitude;
		$wtlongitude = (float)$wtlongitude;

		if (($wtlatitude <= WT_GPS_LAT1) && ($wtlatitude >= WT_GPS_LAT2)) {
			$wt_lat_ok = 1;
		} else if ($wtdebug == 1) {
			$wtlatitude = WT_GPS_LAT2 + (WT_GPS_LAT1 - WT_GPS_LAT2) / 2;
			$wt_lat_ok = 1;
		}

		if (($wtlongitude >= WT_GPS_LONG1) && ($wtlongitude <= WT_GPS_LONG2)) {
			$wt_long_ok = 1;
		} else if ($wtdebug == 1) {
			$wtlongitude = WT_GPS_LONG1 + (WT_GPS_LONG2 - WT_GPS_LONG1) / 2;
			$wt_long_ok = 1;
		}
	}

	wt_gps_css();
	$scantext = wt_gps_letzter_scan_text($wtletzterscan);

	if (($wt_long_ok != 1) || ($wt_lat_ok != 1)) {
		if ($scantext != '') {
			echo '<div class="wtgps-info">' . $scantext . ' &ndash; Position au&szlig;erhalb des Gel&auml;ndes</div>';
		}
		return false;
	}

	// Position im Bild (Pixel): x von West nach Ost, y von Nord nach Sued
	$x = round($wtgpsmapwidth  * ($wtlongitude - WT_GPS_LONG1) / (WT_GPS_LONG2 - WT_GPS_LONG1));
	$y = round($wtgpsmapheight * (WT_GPS_LAT1 - $wtlatitude)   / (WT_GPS_LAT1 - WT_GPS_LAT2));

	$src = htmlspecialchars(wt_gps_luftbild_src($wtrelativeurl), ENT_QUOTES);

	echo '<div class="wtgps" style="width:' . (int)$wtgpsmapwidth . 'px;height:' . (int)$wtgpsmapheight . 'px;">';
	echo '<img src="' . $src . '" width="' . (int)$wtgpsmapwidth . '" height="' . (int)$wtgpsmapheight . '" alt="Luftbild Gel&auml;nde">';
	echo '<span class="wtgps-punkt" style="left:' . (int)$x . 'px;top:' . (int)$y . 'px;"></span>';
	echo '</div>';
	if ($scantext != '') {
		echo '<div class="wtgps-info">' . $scantext . '</div>';
	}
	echo '<div class="wtgps-quelle">Luftbild: &copy; Bayerische Vermessungsverwaltung &ndash; www.geodaten.bayern.de, CC BY 4.0</div>';

	return true;
}	// function wt_display_auto_gps
?>
