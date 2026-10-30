<?php
// Umrechnung GPS <-> Pixel im Geländeplan (ims/gelaende.svg, 952 x 956 px).
// Der Plan ist NICHT genordet (um -36.4° gedreht). Ermittelt aus den
// Gebäudeecken in OpenStreetMap, mittlere Abweichung ca. 2 m. Läuft auch auf PHP 5.

define('GEL_BREITE', 952);
define('GEL_HOEHE', 956);
define('GEL_LAT0', 48.429);
define('GEL_LON0', 13.3225);
define('GEL_MX', 73866.1225);
define('GEL_MY', 111320.0);
define('GEL_A', 4.129406);
define('GEL_B', -3.040997);
define('GEL_C', 361.1014);
define('GEL_D', 396.3646);

// GPS -> Pixel im Plan (x nach rechts, y nach unten)
function gelaende_gps_zu_pixel($lat, $lon)
{
    $x = ($lon - GEL_LON0) * GEL_MX;
    $y = ($lat - GEL_LAT0) * GEL_MY;
    return array(
        'x' => GEL_A * $x - GEL_B * $y + GEL_C,
        'y' => -GEL_B * $x - GEL_A * $y + GEL_D
    );
}

// Pixel im Plan -> GPS
function gelaende_pixel_zu_gps($px, $py)
{
    $u = $px - GEL_C;
    $v = $py - GEL_D;
    $n = GEL_A * GEL_A + GEL_B * GEL_B;
    $x = (GEL_A * $u - GEL_B * $v) / $n;
    $y = (-GEL_B * $u - GEL_A * $v) / $n;
    return array('lat' => GEL_LAT0 + $y / GEL_MY, 'lon' => GEL_LON0 + $x / GEL_MX);
}

// Liegt der Punkt im Plan?
function gelaende_im_plan($p)
{
    return $p['x'] >= 0 && $p['y'] >= 0 && $p['x'] <= GEL_BREITE && $p['y'] <= GEL_HOEHE;
}
