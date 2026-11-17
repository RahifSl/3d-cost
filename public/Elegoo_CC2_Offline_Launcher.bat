@echo off
title Elegoo CC2 Cost Calculator — Local Offline Desktop App
setlocal
cd /d "%~dp0"

set "APP_FILE=%~dp0Elegoo_CC2_Cost_Calculator_Offline.html"
if not exist "%APP_FILE%" (
  echo [ERROR] Please keep Elegoo_CC2_Cost_Calculator_Offline.html in the same folder as this launcher!
  pause
  exit /b 1
)

set "PORT=45820"
set "URL=http://127.0.0.1:%PORT%/"

echo Launching 100%% Local Offline Elegoo CC2 Cost Calculator on %URL% ...

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 600; if (Get-Command chrome -ErrorAction SilentlyContinue) { Start-Process chrome '--app=%URL% --window-size=1400,920' } elseif (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe') { Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' '--app=%URL% --window-size=1400,920' } elseif (Test-Path 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe') { Start-Process 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' '--app=%URL% --window-size=1400,920' } else { Start-Process msedge '--app=%URL% --window-size=1400,920' }"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$listener = New-Object System.Net.HttpListener; " ^
  "$listener.Prefixes.Add($env:URL); " ^
  "try { $listener.Start() } catch { exit 0 }; " ^
  "while ($listener.IsListening) { " ^
  "  $ctx = $listener.GetContext(); " ^
  "  $res = $ctx.Response; " ^
  "  $res.Headers.Add('Cache-Control', 'no-store, no-cache, must-revalidate'); " ^
  "  $path = $ctx.Request.Url.AbsolutePath; " ^
  "  if ($path -eq '/sw.js') { " ^
  "    $swBytes = [System.Text.Encoding]::UTF8.GetBytes('self.addEventListener(\"install\",()=>self.skipWaiting());'); " ^
  "    $res.ContentType = 'application/javascript'; " ^
  "    $res.ContentLength64 = $swBytes.Length; " ^
  "    $res.OutputStream.Write($swBytes, 0, $swBytes.Length); " ^
  "  } else { " ^
  "    $bytes = [System.IO.File]::ReadAllBytes($env:APP_FILE); " ^
  "    $res.ContentType = 'text/html; charset=utf-8'; " ^
  "    $res.ContentLength64 = $bytes.Length; " ^
  "    $res.OutputStream.Write($bytes, 0, $bytes.Length); " ^
  "  } " ^
  "  $res.OutputStream.Close(); " ^
  "}"
