<?php
// Beispiel: Fahrzeugstandorte aus dem Google Sheet abrufen und als Tabelle anzeigen.
// URL und Token müssen zu config.js / apps-script/Code.gs passen.

$sheetUrl = 'https://script.google.com/macros/s/AKfycbwWOFG_skftCNEmb-8sf8p37yRHdUvK8Co0Y8nq1sFfEk5A3eDYXupWuUC2jngg2gQL/exec';
$token    = 'HIER-EIN-GEHEIMES-WORT-EINTRAGEN';

function holeFahrzeuge(string $url, string $token): array
{
    $ch = curl_init($url . '?token=' . urlencode($token));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true, // Apps Script leitet auf googleusercontent.com um
        CURLOPT_TIMEOUT        => 20,
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException('Sheet nicht erreichbar: ' . $err);
    }
    $data = json_decode($body, true);
    if (!is_array($data) || empty($data['ok'])) {
        throw new RuntimeException('Fehler vom Sheet: ' . ($data['error'] ?? 'unbekannte Antwort'));
    }
    return $data['fahrzeuge'];
}

try {
    $fahrzeuge = holeFahrzeuge($sheetUrl, $token);
} catch (RuntimeException $e) {
    http_response_code(502);
    exit(htmlspecialchars($e->getMessage()));
}

// Auto-ID aus dem IMS-Link im QR-Code lesen (autoid ist Base64-kodiert)
function autoIdAusLink(?string $link): ?string
{
    if (!$link) return null;
    parse_str((string)parse_url($link, PHP_URL_QUERY), $q);
    if (empty($q['autoid'])) return null;
    $id = base64_decode(strtr(str_replace(' ', '+', $q['autoid']), '-_', '+/'), true);
    return ($id !== false && ctype_digit(trim($id))) ? trim($id) : null;
}

foreach ($fahrzeuge as &$f) {
    $f['autoId'] = autoIdAusLink($f['link'] ?? null);
}
unset($f);

// Neueste zuerst
usort($fahrzeuge, fn($a, $b) => strcmp($b['zuletztGescannt'], $a['zuletztGescannt']));

$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Fahrzeugstandorte</title>
    <style>
        body { font-family: system-ui, sans-serif; margin: 24px; }
        table { border-collapse: collapse; }
        th, td { padding: 6px 12px; border-bottom: 1px solid #ddd; text-align: left; }
        td.fin { font-family: monospace; }
    </style>
</head>
<body>
<h1>Fahrzeugstandorte (<?= count($fahrzeuge) ?>)</h1>
<table>
    <tr><th>Auto-ID</th><th>FIN</th><th>Zuletzt gescannt</th><th>Genauigkeit</th><th>Standort</th></tr>
    <?php foreach ($fahrzeuge as $f): ?>
        <tr>
            <td><?= $e($f['autoId'] ?? '–') ?></td>
            <td class="fin"><?= $e($f['fin']) ?></td>
            <td><?= $e(date('d.m.Y H:i', strtotime($f['zuletztGescannt']))) ?></td>
            <td><?= $f['genauigkeit'] !== null ? '± ' . $e($f['genauigkeit']) . ' m' : '–' ?></td>
            <td><a href="<?= $e($f['karte']) ?>" target="_blank">Karte</a></td>
        </tr>
    <?php endforeach; ?>
</table>
</body>
</html>
