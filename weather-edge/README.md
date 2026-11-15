# Weather

Current conditions and the forecast, for the Edge: the next 5 days (the default) or the next hours.

**Sizes**, with **Forecast: Next 5 days**:
- **S:** now, plus a column for each of the next 5 days (high, low, and rain chance when it's 20% or more).
- **M:** now on top, then the 5 days as a list with a temperature range bar.
- **Full width:** now, plus the 5 day columns.

With **Forecast: Next hours**:
- **S:** now, plus the next 12 hours.
- **M:** now, the next 6 hours, and 6 days with a temperature range bar.
- **Full width:** all three side by side.

**Settings** (dashboard settings page → Weather, or in iCUE):
- **Location:** a town, like `Denver, CO` or `Paris, France` (US state abbreviations work), or coordinates like `39.74, -104.99`.
- **Units:** °F and mph, or °C and km/h.
- **Forecast:** next 5 days, or next hours.
- **24-hour clock** (for the hours).

**Where the data comes from:** [Open-Meteo](https://open-meteo.com), which is free and needs no account or key.
- The town is looked up once with their geocoder and remembered.
- Forecasts are fetched every 15 minutes.
- Only the rounded coordinates (about 1 km) are sent.
- The location is a setting, so it lives in your settings file, not in this widget.

Icons are drawn in the page, so there are no image files.
