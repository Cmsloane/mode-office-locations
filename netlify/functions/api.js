// MODE IQ Office Analytics — Netlify Function backend
// Ingests Power BI CSV exports and serves per-office load stats

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'mode-iq-analytics';
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || '';

// ─── helpers ────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

// Parse a CSV string into array of objects using first row as headers.
// Handles quoted fields with commas inside and leading BOM characters.
function parseCSV(text) {
  // Strip UTF-8 BOM if present
  const clean = text.replace(/^﻿/, '');
  const lines = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];

  const parseLine = (line) => {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        fields.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    rows.push(obj);
  }
  return rows;
}

// Parse "ORIGIN CITY STATE COUNTRY - DEST CITY STATE COUNTRY" lane strings.
// Returns { origin_state, dest_state } using the second-to-last word in each half.
function parseLane(laneStr) {
  if (!laneStr) return { origin_state: '', dest_state: '' };
  const dashIdx = laneStr.indexOf(' - ');
  if (dashIdx < 0) return { origin_state: '', dest_state: '' };
  const origWords = laneStr.slice(0, dashIdx).trim().split(/\s+/);
  const destWords = laneStr.slice(dashIdx + 3).trim().split(/\s+/);
  return {
    origin_state: origWords.length >= 2 ? origWords[origWords.length - 2] : '',
    dest_state:   destWords.length >= 2 ? destWords[destWords.length - 2] : '',
  };
}

// Extract numeric suffix from an IBO code for map-ID alignment.
// TX-SA217 → "217", TX-AD512 → "512", TX-ABI → "TX-ABI" (no change when no numeric suffix).
function iboToKey(ibo) {
  if (!ibo) return ibo;
  const m = ibo.match(/(\d+)$/);
  return m ? m[1] : ibo;
}

// Normalise a raw Power BI row into our internal load record.
// Supports both per-load format (match_status, origin_state/dest_state) and
// the aggregated Power BI lane report format (IBO, Lane, Volume, Avg Revenue, Profit %).
function normaliseRow(row) {
  const g = (...keys) => {
    for (const k of keys) {
      const v = row[k] || row[k.replace(/_/g, ' ')] || '';
      if (v) return v.trim();
    }
    return '';
  };

  // Office identification — IBO takes priority for Power BI lane reports
  const raw_ibo = g('ibo', 'office_id', 'office', 'branch_id', 'branch', 'location_id', 'location');
  const office_id = raw_ibo ? iboToKey(raw_ibo) : '';
  const office_name = g('ibo_group_name', 'office_name', 'branch_name', 'location_name');

  // Lane: try direct state columns first, then parse the Lane string
  let origin_state = g('origin_state', 'pickup_state', 'o_state');
  let dest_state   = g('dest_state', 'destination_state', 'delivery_state', 'd_state');
  if (!origin_state || !dest_state) {
    const parsed = parseLane(g('lane'));
    if (!origin_state) origin_state = parsed.origin_state;
    if (!dest_state)   dest_state   = parsed.dest_state;
  }

  // Volume: aggregated lane reports provide a row count; default to 1 for per-load data
  const volumeRaw = g('volume').replace(/[,\s]/g, '');
  const volume = parseInt(volumeRaw, 10) || 1;

  // Match status: explicit column takes priority; if absent, rows with revenue/volume
  // are treated as matched (Power BI lane reports only include covered loads)
  const matchRaw = g('match_status', 'matched', 'status', 'load_status').toLowerCase();
  let matched;
  if (matchRaw) {
    matched =
      matchRaw === 'matched' || matchRaw === 'covered' || matchRaw === 'booked' ||
      matchRaw === 'awarded' || matchRaw === 'tendered' ||
      matchRaw === 'yes'     || matchRaw === 'true'    || matchRaw === '1'
        ? true
        : matchRaw === 'unmatched' || matchRaw === 'no' || matchRaw === 'false' || matchRaw === '0'
        ? false
        : null;
  } else {
    // No match_status column — infer matched for rows that have revenue or explicit volume
    matched = (volume > 1 || !!g('avg_revenue', 'total_revenue', 'rate')) ? true : null;
  }

  // Rate: prefer avg_revenue for aggregated reports, fall back to per-load rate columns
  const rateRaw = g('avg_revenue', 'rate', 'load_rate', 'total_rate', 'buy_rate').replace(/[$,\s]/g, '');
  const rate = parseFloat(rateRaw) || null;

  // Profit margin (from aggregated reports; "Profit %" header normalises to "profit_")
  const profitRaw = g('profit_', 'profit_pct', 'margin', 'profit').replace(/[%\s]/g, '');
  const profit_pct = parseFloat(profitRaw) || null;

  const milesRaw = g('miles', 'distance_miles', 'distance', 'mileage').replace(/[,\s]/g, '');
  const miles = parseFloat(milesRaw) || null;

  return {
    load_id:      g('load_id', 'load_number', 'load_#', 'loadid', 'id'),
    office_id,
    office_name,
    posted_date:  g('posted_date', 'date_posted', 'date', 'post_date'),
    origin_city:  g('origin_city', 'pickup_city'),
    origin_state,
    dest_city:    g('dest_city', 'destination_city', 'delivery_city'),
    dest_state,
    equipment:    g('equipment', 'equipment_type', 'equip', 'mode'),
    matched,
    carrier_name: g('carrier_name', 'carrier_name_column', 'carrier', 'assigned_carrier'),
    carrier_mc:   g('carrier_mc', 'mc_number', 'mc'),
    rate,
    miles,
    volume,
    profit_pct,
    customer:     g('customer', 'customer_name', 'shipper'),
  };
}

// Derive top_lanes, top_carriers, monthly_trend summaries from raw dicts.
function summarise(o) {
  o.match_rate    = o.total ? Math.round((o.matched / o.total) * 100) : 0;
  o.avg_rate      = o._rates_n   ? Math.round(o._rates_sum   / o._rates_n)   : null;
  o.avg_miles     = o._miles_n   ? Math.round(o._miles_sum   / o._miles_n)   : null;
  o.avg_profit_pct = o._profit_n ? Math.round((o._profit_sum / o._profit_n) * 10) / 10 : null;

  o.top_lanes = Object.entries(o._lanes || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([lane, count]) => {
      const [orig, dest] = lane.split('→');
      return { orig, dest, count };
    });

  o.top_carriers = Object.entries(o._carriers || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  o.monthly_trend = Object.entries(o._by_month || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, count]) => ({ month, count }));

  o.equipment = o._equipment || {};
}

// Aggregate normalised load records into per-office stats object.
// Volume multiplies every counter so aggregated rows are counted correctly.
function computeStats(records) {
  const offices = {};

  for (const r of records) {
    const key = r.office_id || r.office_name || 'unknown';
    if (!offices[key]) {
      offices[key] = {
        office_id:   r.office_id,
        office_name: r.office_name,
        total:       0,
        matched:     0,
        unmatched:   0,
        unknown:     0,
        _rates_sum:  0,
        _rates_n:    0,
        _miles_sum:  0,
        _miles_n:    0,
        _profit_sum: 0,
        _profit_n:   0,
        _lanes:      {},
        _equipment:  {},
        _by_month:   {},
        _carriers:   {},
      };
    }

    const o   = offices[key];
    const vol = r.volume;

    o.total += vol;
    if (r.matched === true)       o.matched   += vol;
    else if (r.matched === false) o.unmatched += vol;
    else                          o.unknown   += vol;

    if (r.rate)       { o._rates_sum  += r.rate  * vol; o._rates_n  += vol; }
    if (r.miles)      { o._miles_sum  += r.miles * vol; o._miles_n  += vol; }
    if (r.profit_pct) { o._profit_sum += r.profit_pct * vol; o._profit_n += vol; }

    if (r.origin_state && r.dest_state) {
      const lane = `${r.origin_state.toUpperCase()}→${r.dest_state.toUpperCase()}`;
      o._lanes[lane] = (o._lanes[lane] || 0) + vol;
    }

    if (r.equipment) {
      const eq = r.equipment.trim();
      o._equipment[eq] = (o._equipment[eq] || 0) + vol;
    }

    if (r.posted_date) {
      let mo = '';
      const iso = r.posted_date.match(/^(\d{4}-\d{2})/);
      const mdy = r.posted_date.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
      if (iso)      mo = iso[1];
      else if (mdy) mo = `${mdy[2]}-${mdy[1].padStart(2, '0')}`;
      if (mo) o._by_month[mo] = (o._by_month[mo] || 0) + vol;
    }

    if (r.carrier_name) {
      const cn = r.carrier_name.trim();
      o._carriers[cn] = (o._carriers[cn] || 0) + vol;
    }
  }

  for (const o of Object.values(offices)) {
    summarise(o);
  }

  return offices;
}

// Merge a fresh office record on top of existing (append mode).
// Accumulates raw dicts so lane/carrier/monthly history builds across uploads.
function mergeOffice(existing, fresh) {
  const merged = {
    office_id:   fresh.office_id   || existing.office_id,
    office_name: fresh.office_name || existing.office_name,
    total:       existing.total      + fresh.total,
    matched:     existing.matched    + fresh.matched,
    unmatched:   existing.unmatched  + fresh.unmatched,
    unknown:     existing.unknown    + fresh.unknown,
    _rates_sum:  (existing._rates_sum  || 0) + (fresh._rates_sum  || 0),
    _rates_n:    (existing._rates_n    || 0) + (fresh._rates_n    || 0),
    _miles_sum:  (existing._miles_sum  || 0) + (fresh._miles_sum  || 0),
    _miles_n:    (existing._miles_n    || 0) + (fresh._miles_n    || 0),
    _profit_sum: (existing._profit_sum || 0) + (fresh._profit_sum || 0),
    _profit_n:   (existing._profit_n   || 0) + (fresh._profit_n   || 0),
    _lanes:      { ...(existing._lanes     || {}) },
    _equipment:  { ...(existing._equipment || {}) },
    _by_month:   { ...(existing._by_month  || {}) },
    _carriers:   { ...(existing._carriers  || {}) },
  };

  for (const [k, v] of Object.entries(fresh._lanes     || {})) merged._lanes[k]     = (merged._lanes[k]     || 0) + v;
  for (const [k, v] of Object.entries(fresh._equipment || {})) merged._equipment[k] = (merged._equipment[k] || 0) + v;
  for (const [k, v] of Object.entries(fresh._by_month  || {})) merged._by_month[k]  = (merged._by_month[k]  || 0) + v;
  for (const [k, v] of Object.entries(fresh._carriers  || {})) merged._carriers[k]  = (merged._carriers[k]  || 0) + v;

  summarise(merged);
  return merged;
}

// Aggregate an array of office stat objects into a single combined record.
// Used when a map ID like "512; 217; 713" covers multiple stored office entries.
function aggregateOffices(list) {
  if (list.length === 1) return list[0];
  const combined = {
    office_id:   list.map(o => o.office_id).filter(Boolean).join('; '),
    office_name: list[0].office_name || '',
    total:       0, matched: 0, unmatched: 0, unknown: 0,
    _rates_sum: 0, _rates_n: 0,
    _miles_sum: 0, _miles_n: 0,
    _profit_sum: 0, _profit_n: 0,
    _lanes: {}, _equipment: {}, _by_month: {}, _carriers: {},
  };
  for (const o of list) {
    combined.total     += o.total     || 0;
    combined.matched   += o.matched   || 0;
    combined.unmatched += o.unmatched || 0;
    combined.unknown   += o.unknown   || 0;
    combined._rates_sum  += o._rates_sum  || 0; combined._rates_n  += o._rates_n  || 0;
    combined._miles_sum  += o._miles_sum  || 0; combined._miles_n  += o._miles_n  || 0;
    combined._profit_sum += o._profit_sum || 0; combined._profit_n += o._profit_n || 0;
    for (const [k, v] of Object.entries(o._lanes     || {})) combined._lanes[k]     = (combined._lanes[k]     || 0) + v;
    for (const [k, v] of Object.entries(o._equipment || {})) combined._equipment[k] = (combined._equipment[k] || 0) + v;
    for (const [k, v] of Object.entries(o._by_month  || {})) combined._by_month[k]  = (combined._by_month[k]  || 0) + v;
    for (const [k, v] of Object.entries(o._carriers  || {})) combined._carriers[k]  = (combined._carriers[k]  || 0) + v;
  }
  summarise(combined);
  return combined;
}

// Find one or more office entries matching a map ID string.
// Handles: exact match, numeric-suffix lookup, multi-ID format ("512; 217; 713").
function findOffices(all, rawQuery) {
  const q = rawQuery.toLowerCase().trim();

  // Exact match by office_id or office_name
  const exact = Object.values(all).find(
    o => (o.office_id || '').toLowerCase() === q ||
         (o.office_name || '').toLowerCase() === q
  );
  if (exact) return [exact];

  // Multi-ID map format: "512; 217; 713" or "TX-WLM;TX-WMZ" or "(427) (TX-HU427)"
  const parts = q.split(/[;,]\s*|\s+(?=\()|\)\s*\(/)
    .map(s => s.replace(/[()]/g, '').trim())
    .filter(Boolean);

  if (parts.length > 1) {
    const found = [];
    for (const part of parts) {
      const m = Object.values(all).find(o => {
        const oid = (o.office_id || '').toLowerCase();
        return oid === part || oid.endsWith(part);
      });
      if (m && !found.includes(m)) found.push(m);
    }
    if (found.length > 0) return found;
  }

  // Single token — try suffix/prefix match for IBO-code variants
  const candidates = Object.values(all).filter(o => {
    const oid = (o.office_id || '').toLowerCase();
    return oid === q || oid.endsWith(q) || q.endsWith(oid);
  });
  if (candidates.length > 0) return candidates;

  return [];
}

// ─── route handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const { httpMethod: method, path, body, headers, queryStringParameters: qs } = event;
  const seg = path.replace(/^\/\.netlify\/functions\/api\/?/, '').replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const route = seg[0] || '';
  const param = seg.slice(1).join('/') || '';  // support IDs with slashes if any

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Upload-Secret',
      },
      body: '',
    };
  }

  // GET /api/health
  if (method === 'GET' && route === 'health') {
    const s = store();
    let meta = null;
    try { meta = JSON.parse(await s.get('meta') || 'null'); } catch {}
    return json({ ok: true, store: STORE_NAME, meta });
  }

  // GET /api/office-stats  — all offices summary for map overlay
  if (method === 'GET' && route === 'office-stats' && !param) {
    const s = store();
    try {
      const raw = await s.get('all-office-stats');
      if (!raw) return json({ offices: {}, message: 'No data uploaded yet.' });
      return json({ offices: JSON.parse(raw) });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  // GET /api/office-stats/:id  — single office detail
  if (method === 'GET' && route === 'office-stats' && param) {
    const s = store();
    try {
      const raw = await s.get('all-office-stats');
      if (!raw) return json({ error: 'No data uploaded yet.' }, 404);
      const all = JSON.parse(raw);
      const matches = findOffices(all, decodeURIComponent(param));
      if (!matches.length) return json({ error: `Office "${param}" not found.` }, 404);
      return json(aggregateOffices(matches));
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  // POST /api/upload  — ingest Power BI CSV export
  if (method === 'POST' && route === 'upload') {
    if (UPLOAD_SECRET) {
      const provided = headers['x-upload-secret'] || headers['authorization']?.replace(/^Bearer\s+/, '') || (qs && qs.secret) || '';
      if (provided !== UPLOAD_SECRET) return json({ error: 'Unauthorized' }, 401);
    }

    if (!body) return json({ error: 'No body provided.' }, 400);

    let records = [];
    const ct = (headers['content-type'] || '').toLowerCase();

    if (ct.includes('application/json')) {
      try {
        const parsed = JSON.parse(body);
        const arr = Array.isArray(parsed) ? parsed : parsed.data || parsed.records || parsed.rows || [];
        records = arr.map(normaliseRow);
      } catch (e) {
        return json({ error: 'Invalid JSON: ' + e.message }, 400);
      }
    } else {
      try {
        const rows = parseCSV(body);
        if (!rows.length) return json({ error: 'CSV is empty or has no data rows.' }, 400);
        records = rows.map(normaliseRow);
      } catch (e) {
        return json({ error: 'CSV parse error: ' + e.message }, 400);
      }
    }

    if (!records.length) return json({ error: 'No records parsed from upload.' }, 400);

    const s = store();
    const mode = (qs && qs.mode) || 'replace';
    let existing = {};
    if (mode === 'append') {
      try {
        const raw = await s.get('all-office-stats');
        if (raw) existing = JSON.parse(raw);
      } catch {}
    }

    const fresh = computeStats(records);

    let merged = { ...existing };
    for (const [key, stats] of Object.entries(fresh)) {
      if (mode === 'append' && merged[key]) {
        merged[key] = mergeOffice(merged[key], stats);
      } else {
        merged[key] = stats;
      }
    }

    await s.set('all-office-stats', JSON.stringify(merged));

    const meta = {
      last_upload: new Date().toISOString(),
      mode,
      records_ingested: records.length,
      offices_affected: Object.keys(fresh).length,
      total_offices:    Object.keys(merged).length,
    };
    await s.set('meta', JSON.stringify(meta));

    return json({
      ok: true,
      records_ingested: records.length,
      offices_affected: Object.keys(fresh).length,
      total_offices:    Object.keys(merged).length,
    });
  }

  // POST /api/clear  — wipe all data (requires secret)
  if (method === 'POST' && route === 'clear') {
    if (!UPLOAD_SECRET) return json({ error: 'UPLOAD_SECRET must be set to use /clear.' }, 403);
    const provided = headers['x-upload-secret'] || (qs && qs.secret) || '';
    if (provided !== UPLOAD_SECRET) return json({ error: 'Unauthorized' }, 401);
    const s = store();
    await s.delete('all-office-stats');
    await s.delete('meta');
    return json({ ok: true, message: 'All analytics data cleared.' });
  }

  return json({ error: `Unknown route: ${route || '/'}` }, 404);
};
