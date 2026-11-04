          //gpsposition: Luftbild mit blinkendem Punkt + "Letzter Scan"
          //(ersetzt den bisherigen Block in der Fahrzeugansicht; gps-functions.php muss eingebunden sein)
          $gpssql = 'SELECT * FROM ims.autos_gpsdaten WHERE autoid = ' . (int)$car_arr['auto_id'] . ' ORDER BY datetime desc LIMIT 1;';
          $gpsresult = mysql_query($gpssql);
          if ($gpsresult && ($gps_arr = mysql_fetch_array($gpsresult))) {
            wt_display_auto_gps(400, 400, $gps_arr['latitude_raw'], $gps_arr['longitude_raw'], 0, 'api/', $gps_arr['datetime']);
          } else {
            echo '<div style="font-family:Tahoma,Arial,sans-serif;font-size:13px;"><b>Letzter Scan:</b> noch nicht gescannt</div>';
          } ?>
