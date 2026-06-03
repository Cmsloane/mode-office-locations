# Power BI Export Guide — MODE IQ Analytics

## How to export from Power BI

1. Open your load data report in Power BI
2. Click **Export data** (the ... menu on any table visual)
3. Choose **Summarized data** or **Underlying data** → **CSV**
4. Save the file
5. Upload via: `POST https://mode-office-locations.netlify.app/api/upload`

---

## Required CSV Columns

The API is flexible with column names — use any of the aliases listed below.

| Data Point | Accepted Column Names |
|---|---|
| Office identifier | `office_id`, `branch_id`, `location_id` |
| Office name | `office_name`, `branch_name`, `location_name` |
| Load number | `load_id`, `load_number`, `load_#` |
| Post date | `posted_date`, `date_posted`, `date`, `post_date` |
| Origin city | `origin_city`, `pickup_city` |
| Origin state | `origin_state`, `pickup_state` |
| Destination city | `dest_city`, `destination_city`, `delivery_city` |
| Destination state | `dest_state`, `destination_state`, `delivery_state` |
| Equipment type | `equipment`, `equipment_type`, `equip` |
| Match status | `match_status`, `matched`, `status` → values: `Matched`/`Unmatched` or `Yes`/`No` |
| Carrier name | `carrier_name`, `carrier` |
| Carrier MC# | `carrier_mc`, `mc_number` |
| Rate | `rate`, `load_rate`, `buy_rate` → dollar amount, `$` and commas are stripped |
| Miles | `miles`, `distance_miles`, `mileage` |
| Customer | `customer`, `customer_name`, `shipper` |

### Minimum viable export (must have at least these)
- `office_id` or `office_name`
- `match_status`
- `origin_state` + `dest_state`

---

## Example CSV

```
office_id,office_name,load_id,posted_date,origin_city,origin_state,dest_city,dest_state,equipment,match_status,carrier_name,carrier_mc,rate,miles,customer
TX-DA201,Dallas - Smith,2401001,2026-05-01,Dallas,TX,Chicago,IL,Dry Van,Matched,ABC Transport,MC-123456,$2400,920,Acme Corp
TX-DA201,Dallas - Smith,2401002,2026-05-01,Fort Worth,TX,Memphis,TN,Reefer,Unmatched,,,,,XYZ Foods
IL-CH055,Chicago - Jones,2401003,2026-05-02,Chicago,IL,Detroit,MI,Flatbed,Matched,DEF Trucking,MC-789012,$1800,310,Widget Co
```

---

## Upload API

### Replace all data (fresh upload)
```bash
curl -X POST https://mode-office-locations.netlify.app/api/upload \
  -H "Content-Type: text/csv" \
  -H "X-Upload-Secret: YOUR_SECRET" \
  --data-binary @your_export.csv
```

### Append to existing data
```bash
curl -X POST "https://mode-office-locations.netlify.app/api/upload?mode=append" \
  -H "Content-Type: text/csv" \
  -H "X-Upload-Secret: YOUR_SECRET" \
  --data-binary @your_export.csv
```

### Upload JSON instead of CSV
```bash
curl -X POST https://mode-office-locations.netlify.app/api/upload \
  -H "Content-Type: application/json" \
  -H "X-Upload-Secret: YOUR_SECRET" \
  -d '[{"office_id":"TX-DA201","match_status":"Matched",...}]'
```

---

## Netlify Environment Variables to Set

In Netlify dashboard → Site → Environment variables:

| Variable | Value | Required |
|---|---|---|
| `UPLOAD_SECRET` | Any strong secret string | Recommended — omit to allow unauthenticated uploads |

---

## API Responses

### GET /api/health
```json
{ "ok": true, "store": "mode-iq-analytics", "meta": { "last_upload": "2026-06-03T...", "records_ingested": 450 } }
```

### GET /api/office-stats
Returns all offices with aggregated stats:
```json
{
  "offices": {
    "TX-DA201": {
      "office_id": "TX-DA201",
      "office_name": "Dallas - Smith",
      "total": 142,
      "matched": 118,
      "unmatched": 24,
      "match_rate": 83,
      "avg_rate": 2310,
      "avg_miles": 740,
      "top_lanes": [
        { "orig": "TX", "dest": "IL", "count": 22 },
        { "orig": "TX", "dest": "TN", "count": 18 }
      ],
      "top_carriers": [
        { "name": "ABC Transport", "count": 14 }
      ],
      "monthly_trend": [
        { "month": "2026-04", "count": 68 },
        { "month": "2026-05", "count": 74 }
      ],
      "equipment": { "Dry Van": 98, "Reefer": 44 }
    }
  }
}
```

### GET /api/office-stats/:office_id
Same structure as above but for a single office.
