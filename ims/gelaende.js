// Umrechnung GPS <-> Pixel im Geländeplan (ims/gelaende.svg, 952 x 956 px).
// Der Plan ist NICHT genordet (um -36.3° gedreht). Ermittelt aus den
// Gebäudeecken in OpenStreetMap, mittlere Abweichung ca. 2 m.
// Schuster, Rotthofer Straße 10, 94099 Ruhstorf a.d.Rott.

const GELAENDE = {
    breite: 952, hoehe: 956,
    lat0: 48.429, lon0: 13.3225,          // Bezugspunkt
    mx: 73866.1225, my: 111320.0,          // Meter pro Grad (Länge / Breite)
    a: 4.156256, b: -3.057419,            // Drehung + Maßstab (5.160 px/m)
    c: 362.0724, d: 395.5246           // Verschiebung (px)
};

// GPS -> Pixel im Plan (x nach rechts, y nach unten)
function gpsZuPixel(lat, lon) {
    const g = GELAENDE;
    const x = (lon - g.lon0) * g.mx, y = (lat - g.lat0) * g.my;   // Meter Ost / Nord
    return { x: g.a * x - g.b * y + g.c, y: -g.b * x - g.a * y + g.d };
}

// Pixel im Plan -> GPS
function pixelZuGps(px, py) {
    const g = GELAENDE, u = px - g.c, v = py - g.d, n = g.a * g.a + g.b * g.b;
    const x = (g.a * u - g.b * v) / n, y = (-g.b * u - g.a * v) / n;
    return { lat: g.lat0 + y / g.my, lon: g.lon0 + x / g.mx };
}

// Liegt der Punkt im Plan?
function imPlan(p) { return p.x >= 0 && p.y >= 0 && p.x <= GELAENDE.breite && p.y <= GELAENDE.hoehe; }

if (typeof module !== "undefined") module.exports = { GELAENDE, gpsZuPixel, pixelZuGps, imPlan };
