# Weather

Current conditions, the next hours and the days ahead, for the Edge.

**Sizes:**
- **S:** now, plus the next 12 hours.
- **M:** now, the next 6 hours, and 6 days with a temperature range bar.
- **Full width:** all three side by side.

**Settings** (dashboard settings page → Weather, or in iCUE):
- **Location:** a town, like `West Orange, NJ` or `Paris, France` (US state abbreviations work), or coordinates like `40.80, -74.24`.
- **Units:** °F and mph, or °C and km/h.
- **24-hour clock.**

**Where the data comes from:** [Open-Meteo](https://open-meteo.com), which is free and needs no account or key.
- The town is looked up once with their geocoder and remembered.
- Forecasts are fetched every 15 minutes.
- Only the rounded coordinates (about 1 km) are sent.
- The location is a setting, so it lives in your settings file, not in this widget.

Icons are drawn in the page, so there are no image files.
