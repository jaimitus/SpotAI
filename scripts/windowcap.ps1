# Captures a window by process name to a PNG file.
param(
  [string]$Process = "spotai",
  [string]$Out = "window.png"
)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$p = Get-Process -Name $Process -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Error "No window for process $Process"; exit 1 }
$h = $p.MainWindowHandle
$visible = [W32]::IsWindowVisible($h)
Write-Output "Handle=$h Visible=$visible Title='$($p.MainWindowTitle)'"
if (-not $visible) { Write-Error "Window is hidden (spotlight apps hide on start)"; exit 2 }
[W32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 500
$r = New-Object W32+RECT
[W32]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $ht = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "Saved $Out ($w x $ht at $($r.L),$($r.T))"
