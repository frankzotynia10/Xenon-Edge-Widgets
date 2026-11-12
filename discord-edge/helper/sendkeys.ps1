# Presses a key combo via SendInput using hardware scan codes.
# Usage: sendkeys.ps1 <vk> <vk> ...   (decimal virtual-key codes, modifiers first)
param([Parameter(ValueFromRemainingArguments = $true)][int[]]$Keys)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EdgeKeys {
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)]
  struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  public static uint Key(ushort vk, bool up) {
    var i = new INPUT[1];
    i[0].type = 1; // INPUT_KEYBOARD
    i[0].ki.wVk = 0;
    i[0].ki.wScan = (ushort)MapVirtualKey(vk, 0);
    i[0].ki.dwFlags = 0x0008u | (up ? 0x0002u : 0u); // SCANCODE | KEYUP
    return SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
foreach ($k in $Keys) { if ([EdgeKeys]::Key([uint16]$k, $false) -ne 1) { Write-Error "SendInput down failed for $k" }; Start-Sleep -Milliseconds 15 }
Start-Sleep -Milliseconds 60
[array]::Reverse($Keys)
foreach ($k in $Keys) { if ([EdgeKeys]::Key([uint16]$k, $true) -ne 1) { Write-Error "SendInput up failed for $k" }; Start-Sleep -Milliseconds 15 }
