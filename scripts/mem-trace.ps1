$out = 'C:\Users\Administrator\.dsh\plugin-src\dsh-consciousness\docs\mem-trace.csv'
'Time,TotalMB,TopPid,TopMB' | Set-Content $out -Encoding UTF8
for ($i = 0; $i -lt 300; $i++) {
  $ps = Get-Process | Where-Object { $_.ProcessName -match 'DeepSeek Harness' }
  $sum = ($ps | Measure-Object WorkingSet64 -Sum).Sum / 1MB
  $top = $ps | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
  $line = (Get-Date).ToString('HH:mm:ss') + ',' + [math]::Round($sum) + ',' + $top.Id + ',' + [math]::Round($top.WorkingSet64/1MB)
  Add-Content $out $line -Encoding UTF8
  Start-Sleep -Seconds 1
}