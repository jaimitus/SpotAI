# Captures the primary screen (or a specific window) to a PNG file.
param(
  [string]$Out = "screen.png",
  [string]$WindowTitle = "",
  [int]$Left = 0, [int]$Top = 0, [int]$Width = 0, [int]$Height = 0
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if ($WindowTitle -ne "") {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
  $h = [Win32]::FindWindow($null, $WindowTitle)
  if ($h -eq [IntPtr]::Zero) { Write-Error "Window not found: $WindowTitle"; exit 1 }
  [Win32]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 400
  $r = New-Object Win32+RECT
  [Win32]::GetWindowRect($h, [ref]$r) | Out-Null
  $Left = $r.L; $Top = $r.T
  $Width = $r.R - $r.L; $Height = $r.B - $r.T
}

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($Width -le 0) { $Width = $bounds.Width - $Left }
if ($Height -le 0) { $Height = $bounds.Height - $Top }

$bmp = New-Object System.Drawing.Bitmap($Width, $Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($Left, $Top, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "Saved $Out ($Width x $Height at $Left,$Top)"
