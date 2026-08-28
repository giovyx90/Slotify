@echo off
rem Slotify launcher - runs the app in its own window (Edge/WebView2 app mode).
rem Bridge until the native Tauri build lands; safe to keep using after, too.
cd /d "%~dp0"

rem Start the dev server only if nothing is listening on 1420 yet.
powershell -NoProfile -Command "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', 1420); $up = $true } catch { $up = $false } finally { $c.Close() }; if (-not $up) { Start-Process -WindowStyle Hidden cmd -ArgumentList '/c npm run dev' ; Start-Sleep -Seconds 4 }"

start "" msedge --app=http://localhost:1420 --window-size=1280,800
