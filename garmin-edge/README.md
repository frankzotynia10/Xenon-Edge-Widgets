# Garmin

Today from your Garmin, at a glance: Body Battery, sleep, HRV, training readiness, resting heart rate, steps, stress and training load. Each tile has a 7-day trend, and HRV, readiness, resting HR and stress show the change since yesterday (green when it moved the good way).

It reads the `garmin_daily` table of a self-hosted [fitness-sync](https://github.com/frankzotynia10) stack (Garmin Connect → PostgreSQL) through its PostgREST API. It doesn't talk to Garmin itself.

| Size | Layout |
|---|---|
| S | All 8 tiles in two rows |
| Wide / full width | All 8 in one row |
| M and L | Two columns of wide tiles, with the trend beside each number |

## Setup
In the widget's settings (dashboard settings → Garmin), set **Data URL** to your PostgREST address, for example `http://tower:3001`. It reads every 5 minutes; the stack's own Garmin sync runs hourly, and the header says when it last synced.

Edge dashboard only. iCUE needs every address a widget uses written into its package, and this one is yours to choose.
