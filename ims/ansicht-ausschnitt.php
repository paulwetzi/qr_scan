              // Standort des Fahrzeugs: Luftbild mit blinkendem Punkt + "Letzter Scan".
              // Ersetzt den bisherigen Block mit gelaende.php / Gelaendeplan.svg.
              // Kein Standort, keine Auto-ID oder DB-Fehler -> nur ein Hinweis, kein Fehler.
              include_once dirname(__FILE__) . '/api/gps-functions.php';

              $autoid = isset($car_arr['auto_id']) ? (int)$car_arr['auto_id'] : 0;
              $gps_row = false;
              if ($autoid > 0) {
                  $res = @mysql_query("SELECT latitude_raw, longitude_raw, `datetime` FROM `ims`.`autos_gpsdaten`
                                       WHERE autoid = " . $autoid . " ORDER BY `datetime` DESC LIMIT 1");
                  if ($res) {
                      $gps_row = mysql_fetch_assoc($res);
                  }
              }

              if ($gps_row && $gps_row['latitude_raw'] != '' && $gps_row['longitude_raw'] != ''
                  && function_exists('wt_display_auto_gps')) {
                  // 350 x 352 = gleiches Seitenverhaeltnis wie der Plan (952 x 956)
                  wt_display_auto_gps(350, 352, $gps_row['latitude_raw'], $gps_row['longitude_raw'], 0, 'api/', $gps_row['datetime']);
              } else {
                  echo '<div style="font-family:Tahoma,Arial,sans-serif;font-size:13px;"><b>Letzter Scan:</b> noch kein Standort erfasst</div>';
              }
