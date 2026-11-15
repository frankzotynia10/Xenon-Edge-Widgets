# Weather

Current conditions, the next hours and the days ahead, for the Edge.

The forecast is shown as tiles: one per day (high, low) or per hour, each with its rain chance (blue from 20%). Every size uses the same tiles and text sizes.

**Sizes:**
- **S:** now, plus either the next 5 days or the next 12 hours. **Tap the forecast to switch**; the "Forecast on the S size" setting picks which one it starts with.
- **M:** now on top, then the next 6 hours, then the next 5 days.
- **L:** now on the left; the hours and the 5 days on the right.
- **Wide and full width:** now, the hours and the 5 days side by side.

**Settings** (dashboard settings page → Weather, or in iCUE):
- **Location:** a town, like `Denver, CO` or `Paris, France` (US state abbreviations work), or coordinates like `39.74, -104.99`.
- **Units:** °F and mph, or °C and km/h.
- **Forecast on the S size:** next 5 days (default) or next hours. A tap on the forecast switches it until you change this setting.
- **24-hour clock** (for the hours).

**Where the data comes from:** [Open-Meteo](https://open-meteo.com), which is free and needs no account or key.
- The town is looked up once with their geocoder and remembered.
- Forecasts are fetched every 15 minutes.
- Only the rounded coordinates (about 1 km) are sent.
- The location is a setting, so it lives in your settings file, not in this widget.

Icons are drawn in the page, so there are no image files.
