<?php
// Übersicht: alle Fahrzeugstandorte aus dem Google Sheet als Tabelle (PHP 5.3+).
// URL und Token müssen zu config.js / apps-script/Code.gs passen.
// Zum Eintragen in die IMS-Datenbank siehe ims/gps-sync.php.

$sheetUrl = 'https://script.google.com/macros/s/AKfycbwWOFG_skftCNEmb-8sf8p37yRHdUvK8Co0Y8nq1sFfEk5A3eDYXupWuUC2jngg2gQL/exec';
$token    = 'HIER-EIN-GEHEIMES-WORT-EINTRAGEN';

function holeFahrzeuge($url, $token)
{
    $ch = curl_init($url . '?token=' . urlencode($token));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true); // Apps Script leitet auf googleusercontent.com um
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException('Sheet nicht erreichbar: ' . $err);
    }
    $data = json_decode($body, true);
    if (!is_array($data) || empty($data['ok'])) {
        throw new RuntimeException('Fehler vom Sheet: ' . (isset($data['error']) ? $data['error'] : 'unbekannte Antwort'));
    }
    return $data['fahrzeuge'];
}

// Auto-ID aus dem IMS-Link im QR-Code lesen (autoid ist Base64-kodiert)
function autoIdAusLink($link)
{
    if (!$link) return null;
    parse_str((string)parse_url($link, PHP_URL_QUERY), $q);
    if (empty($q['autoid'])) return null;
    $id = base64_decode(strtr(str_replace(' ', '+', $q['autoid']), '-_', '+/'), true);
    return ($id !== false && ctype_digit(trim($id))) ? trim($id) : null;
}

function e($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function nachZeitAbsteigend($a, $b)
{
    return strcmp($b['zuletztGescannt'], $a['zuletztGescannt']);
}

try {
    $fahrzeuge = holeFahrzeuge($sheetUrl, $token);
} catch (RuntimeException $ex) {
    header('HTTP/1.1 502 Bad Gateway');
    exit(e($ex->getMessage()));
}

foreach ($fahrzeuge as $i => $f) {
    $fahrzeuge[$i]['autoId'] = autoIdAusLink(isset($f['link']) ? $f['link'] : null);
}
usort($fahrzeuge, 'nachZeitAbsteigend');
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
<h1>Fahrzeugstandorte (<?php echo count($fahrzeuge); ?>)</h1>
<table>
    <tr><th>Auto-ID</th><th>FIN</th><th>Zuletzt gescannt</th><th>Genauigkeit</th><th>Standort</th></tr>
    <?php foreach ($fahrzeuge as $f) { ?>
        <tr>
            <td><?php echo e($f['autoId'] !== null ? $f['autoId'] : '–'); ?></td>
            <td class="fin"><?php echo e($f['fin']); ?></td>
            <td><?php echo e(date('d.m.Y H:i', strtotime($f['zuletztGescannt']))); ?></td>
            <td><?php echo $f['genauigkeit'] !== null ? '± ' . e($f['genauigkeit']) . ' m' : '–'; ?></td>
            <td><a href="<?php echo e($f['karte']); ?>" target="_blank">Karte</a></td>
        </tr>
    <?php } ?>
</table>
</body>
</html>
