# Power BI Export Guide — MODE IQ Analytics

## Supported Export Formats

The API accepts **two CSV formats** depending on which Power BI report you export from:

---

### Format A — Lane Performance Report (recommended)
This is the standard MODE Power BI lane report. Each row is a lane + carrier combination with aggregated volume, revenue, and profit data.

**Required columns** (exact names from Power BI):

| Column | Notes |
|---|---|
| `IBO` | Office identifier (e.g. `TX-SA217`). Rows with the same numeric suffix are merged into one map pin. |
| `IBO Group Name` | Office group name (e.g. `HOUSTON, TX - ADAMS`) |
| `Lane` | Format: `ORIGIN CITY STATE COUNTRY - DEST CITY STATE COUNTRY` (e.g. `JACKSON TN US - LAREDO TX US`) |
| `Volume` | Number of loads this lane+carrier row represents |
| `Avg Revenue` | Average revenue per load (dollar amount, `$` and commas are stripped) |
| `Profit %` | Profit margin percentage (e.g. `18.97%`) |
| `Carrier Name Column` | Carrier name |
| `Customer` | Customer/shipper name |

**Map display** (for this format):
- Primary KPI: **Profit Margin** (green ≥20%, yellow ≥12%, red <12%)
- Loads: sum of `Volume` column
- Avg Revenue: weighted average of `Avg Revenue` × `Volume`
- Top Lanes: highest-volume origin→destination state pairs
- Warn indicator: yellow dot on map pins with profit margin below 12%

---

### Format B — Load-Level Matching Report
Per-load export with explicit match status. Use this when your Power BI report tracks individual load outcomes.

| Column | Accepted Names |
|---|---|
| Office identifier | `office_id`, `branch_id`, `location_id` |
| Office name | `office_name`, `branch_name`, `location_name` |
| Match status | `match_status`, `matched`, `status` → values: `Matched`/`Yes`/`True`/`1` or `Unmatched`/`No`/`False`/`0`; also accepts `covered`, `booked`, `awarded`, `tendered` |
| Origin state | `origin_state`, `pickup_state`, or parsed from `Lane` column |
| Destination state | `dest_state`, `destination_state` |
| Rate | `rate`, `load_rate`, `buy_rate` |
| Post date | `posted_date`, `date_posted`, `date` (format: `YYYY-MM-DD` or `MM/DD/YYYY`) |
| Carrier name | `carrier_name`, `carrier_name_column`, `carrier` |

**Map display** (for this format):
- Primary KPI: **Match Rate** (green ≥80%, yellow ≥60%, red <60%)
- Warn indicator: yellow dot on pins with match rate below 70%

---

## How to Export from Power BI

1. Open your load data report in Power BI
2. Click the **...** menu on the table visual → **Export data**
3. Choose **Summarized data** → **CSV**
4. Save the file

The API automatically detects which format you're using based on the column names present.

---

## Upload API

### Replace all data (fresh upload)
```bash
curl -X POST https://mode-office-locations.netlify.app/api/upload \
  -H "Content-Type: text/csv" \
  -H "X-Upload-Secret: YOUR_SECRET" \
  --data-binary @your_export.csv
```

### Append to existing data (keeps history)
```bash
curl -X POST "https://mode-office-locations.netlify.app/api/upload?mode=append" \
  -H "Content-Type: text/csv" \
  -H "X-Upload-Secret: YOUR_SECRET" \
  --data-binary @your_export.csv
```

Use `replace` (default) for month-end snapshots. Use `append` for incremental weekly uploads — lane, carrier, and monthly trend data accumulates across uploads.

---

## Office ID Matching

The `IBO` column in the Power BI export uses codes like `TX-SA217`. The map groups offices by the **numeric suffix** — so `TX-SA217` and `TX-AD217` both map to key `217`, which corresponds to the map pin whose ID contains `217`.

Multi-IBO map pins (e.g., ID `512; 217; 713`) automatically aggregate stats from all matching IBO codes.

---

## Verify an Upload

```bash
# Check last upload timestamp and record counts
curl https://mode-office-locations.netlify.app/api/health

# View all offices (for map overlay)
curl https://mode-office-locations.netlify.app/api/office-stats

# Check a specific office by numeric IBO suffix
curl "https://mode-office-locations.netlify.app/api/office-stats/217"

# Or by the full map pin ID
curl "https://mode-office-locations.netlify.app/api/office-stats/512%3B%20217%3B%20713"
```

---

## Netlify Environment Variable

Set in Netlify dashboard → Site → Environment variables:

| Variable | Value |
|---|---|
| `UPLOAD_SECRET` | Any strong secret — passed as `X-Upload-Secret` header when uploading |

If no secret is set, the upload endpoint is open.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401 Unauthorized` | Check your `X-Upload-Secret` matches the Netlify env var |
| `400 No records parsed` | Verify CSV has at least an `IBO` or `office_id` column |
| Office shows "No analytics data" | The IBO numeric suffix doesn't match the map pin ID — compare the number in the IBO code (e.g., `217` from `TX-SA217`) with the map pin's ID |
| Profit margin seems wrong | Verify the `Profit %` column is included and has numeric values like `18.97%` |
