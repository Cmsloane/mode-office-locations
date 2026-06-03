# Power BI Export Guide — MODE Carrier Engagement Analytics

This guide tells the carrier engagement team how to export load data from Power BI and upload it to the MODE Office Map so each office's analytics panel shows live match rates and lane activity.

---

## What Gets Shown on the Map

When an office pin is clicked, the map shows:
- **Match Rate** — % of posted loads that found a carrier (color-coded: green ≥80%, yellow ≥60%, red <60%)
- **Loads Posted** — total load count in the dataset
- **Avg Rate** — average linehaul rate across matched loads
- **Top 5 Lanes** — highest-volume origin → destination state pairs
- **Monthly Trend** — match rate by month (most recent 12 months)

---

## Step 1 — Export from Power BI

Export a CSV or JSON from your Power BI load-matching report. The upload endpoint accepts flexible column names, but the following columns are **required**:

| Column | Required | Accepted names |
|---|---|---|
| Office identifier | **YES** | `office_id`, `officeid`, `office_name`, `office` |
| Match status | **YES** | `match_status`, `matchstatus`, `status`, `match` |
| Origin state | **YES** | `origin_state`, `originstate`, `origin`, `from_state` |
| Destination state | **YES** | `dest_state`, `deststate`, `destination`, `to_state` |
| Load ID | no | `load_id`, `loadid`, `load`, `shipment_id` |
| Posted date | no* | `posted_date`, `posteddate`, `date`, `load_date` |
| Rate (USD) | no | `rate`, `rate_usd`, `linehaul`, `amount` |
| Miles | no | `miles`, `distance`, `mileage` |
| Equipment type | no | `equipment`, `equip`, `equipment_type` |
| Carrier name | no | `carrier_name`, `carriername`, `carrier` |
| Customer / shipper | no | `customer`, `customer_name`, `shipper` |

*\* `posted_date` is needed for the monthly trend chart. Format: `YYYY-MM-DD`.*

### Accepted match_status values
A load is counted as **matched** if the status is (case-insensitive): `matched`, `covered`, `booked`, `awarded`, or `tendered`. All other values count as unmatched.

### Office ID matching
The `office_id` (or `office_name`) in your export must match the **ID field** shown on each office's detail card on the map (e.g., `923; 366`, `AL-DM`, `TX-DA201`). Work with the tech team to confirm the mapping once before the first upload.

---

## Step 2 — Upload to the Map

### Option A — Curl (one-liner for automation)

```bash
# Replace mode (default) — clears previous data, loads fresh batch
curl -X POST https://mode-office-locations.netlify.app/api/upload \
  -H "Content-Type: text/csv" \
  -H "X-Upload-Secret: YOUR_SECRET_HERE" \
  --data-binary @/path/to/export.csv

# Append mode — merges with existing history, keeps all prior months
curl -X POST "https://mode-office-locations.netlify.app/api/upload?mode=append" \
  -H "Content-Type: text/csv" \
  -H "X-Upload-Secret: YOUR_SECRET_HERE" \
  --data-binary @/path/to/export.csv
```

For JSON instead of CSV, change the Content-Type header:
```bash
-H "Content-Type: application/json"
```

The JSON body should be an array of objects, one per load row.

### Option B — Power BI Scheduled Export + Webhook
Power BI Dataflows can call an HTTP endpoint on a schedule. Configure a Dataflow to POST the export to the upload URL above on a weekly or monthly schedule.

### Option C — Manual upload via a form (future)
A drag-and-drop upload form is planned for a future version. For now, use curl or the scheduled export.

---

## Step 3 — Verify the Upload

```bash
# Check the last upload timestamp and record counts
curl https://mode-office-locations.netlify.app/api/health

# View all office stats (summary view)
curl https://mode-office-locations.netlify.app/api/office-stats

# Check a specific office (use the office_id from the map)
curl https://mode-office-locations.netlify.app/api/office-stats/TX-DA201
```

The map's analytics panels update immediately on the next page load after a successful upload.

---

## Data Retention

- **Replace mode** (default): each upload wipes the previous dataset. Use this for month-end snapshots where you want a clean slate.
- **Append mode** (`?mode=append`): merges the new batch with all previous uploads. Monthly trend history accumulates across uploads. Use this for incremental weekly updates.

The `api/health` endpoint shows how many append operations have been applied since the last replace.

---

## Security

The upload endpoint is protected by a secret key (`X-Upload-Secret` header). Get this key from the Netlify dashboard under:

> **Netlify Dashboard** → mode-office-locations site → **Site configuration** → **Environment variables** → `UPLOAD_SECRET`

If no secret is configured, the endpoint is open. Always configure a secret before sharing the upload URL with external tools.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401 Unauthorized` | Check your `X-Upload-Secret` header matches the Netlify env var |
| `400 No valid records` | Verify your CSV has an `office_id` or `office_name` column |
| Office shows "No analytics data" on map | The `office_id` in your export doesn't match the map's ID — compare with the detail card |
| Match rate seems wrong | Check that your `match_status` values are one of: matched, covered, booked, awarded, tendered |
| Monthly trend is blank | Add a `posted_date` column in `YYYY-MM-DD` format |
