# Sensor Box widget for Xeneon Edge

GPU temperature, usage and VRAM; CPU temperature and usage; system memory. While you're in a game, it also shows a small FPS readout.

- **Import:** `sensor-box.icuewidget` into iCUE.
- **Sensor data:** iCUE's own sensor API, except system memory. Memory comes from the combined Edge helper (`../edge-helper/system.js`, port 6792), so it shows "helper offline" if the helper isn't running.

## Files
- `widget/` is the widget source:
  - `index.html`, `manifest.json`, `translation.json`
  - `resources/`: the widget's icon and preview images
  - `common/plugins/`: Corsair's iCUE API wrappers
- **Rebuilding the package:** run `icuewidget package widget` in this folder, then re-import.
