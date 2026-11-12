' Toggles the Edge sleep cover (dim wallpaper) with no window.
' Point a Stream Deck "System > Open" action at this file - or use a "Hotkey" action with Ctrl+Alt+Shift+F10.
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 1000, 1000, 2000, 2000
http.open "GET", "http://127.0.0.1:6792/sleep/toggle", False
http.send
