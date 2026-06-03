import { getStore } from '@netlify/blobs';

const STORE_NAME = 'mode-iq-analytics';

// ── CSV parser ──────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  function parseLine(line) {
    const fields = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { fields.push(cur); cur = ''; }
        else cur += c;
      }
    }
    fields.push(cur);
    return fields;
  }

  if (!lines[0]?.trim()) return [];
  const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

// ── Flexible column normalizer ──────────────────────────────────────────────

function normalizeRow(row) {
  const find = (...names) => {
    for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
    return '';
  };
  return {
    office_id:   find('office_id', 'officeid', 'office_id_', 'id'),
    office_name: find('office_name', 'officename', 'office', 'office_label'),
    match_status: find('match_status', 'matchstatus', 'status', 'match'),
    origin_state: find('origin_state', 'originstate', 'origin', 'orig_state', 'from_state'),
    dest_state:  find('dest_state', 'deststate', 'destination', 'dest', 'to_state'),
    load_id:     find('load_id', 'loadid', 'load', 'shipment_id'),
    posted_date: find('posted_date', 'posteddate', 'date', 'post_date', 'load_date'),
    rate:        find('rate', 'rate_usd', 'linehaul', 'amount', 'price'),
    miles:       find('miles', 'distance', 'mileage', 'total_miles'),
    equipment:   find('equipment', 'equip', 'equipment_type', 'trailer_type'),
    carrier_name: find('carrier_name', 'carriername', 'carrier', 'scac'),
    customer:    find('customer', 'customer_name', 'shipper', 'account'),
  };
}

// ── Stats computation ───────────────────────────────────────────────────────

const MATCHED_STATUSES = new Set(['matched', 'covered', 'booked', 'awarded', 'tendered']);

function computeOfficeStats(records) {
  // Returns map of office_id → raw aggregates
  const raw = {};

  for (const r of records) {
    const id = (r.office_id || r.office_name || '').trim();
    if (!id) continue;

    if (!raw[id]) {
      raw[id] = {
        office_id: id,
        office_name: r.office_name || id,
        total: 0,
        matched: 0,
        rate_sum: 0,
        rate_count: 0,
        lane_counts: {},   // "OR → CA": n
        monthly_raw: {},   // "2026-01": { total, matched }
      };
    }

    const s = raw[id];
    s.total++;

    const status = (r.match_status || '').toLowerCase().trim();
    if (MATCHED_STATUSES.has(status)) s.matched++;

    const rate = parseFloat(r.rate);
    if (!isNaN(rate) && rate > 0) { s.rate_sum += rate; s.rate_count++; }

    const orig = (r.origin_state || '').trim().toUpperCase();
    const dest = (r.dest_state || '').trim().toUpperCase();
    if (orig && dest) {
      const lane = `${orig} → ${dest}`;
      s.lane_counts[lane] = (s.lane_counts[lane] || 0) + 1;
    }

    const dateStr = (r.posted_date || '').trim();
    const month = dateStr.length >= 7 ? dateStr.substring(0, 7) : null; // YYYY-MM
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const m = s.monthly_raw[month] || (s.monthly_raw[month] = { total: 0, matched: 0 });
      m.total++;
      if (MATCHED_STATUSES.has(status)) m.matched++;
    }
  }

  return raw;
}

function deriveDisplayFields(raw) {
  const top_lanes = Object.entries(raw.lane_counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lane, count]) => ({ lane, count }));

  const monthly = Object.entries(raw.monthly_raw)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, m]) => ({
      month,
      total: m.total,
      matched: m.matched,
      rate: m.total ? Math.round(m.matched / m.total * 100) : 0,
    }));

  return {
    office_id: raw.office_id,
    office_name: raw.office_name,
    total_loads: raw.total,
    matched_loads: raw.matched,
    match_rate: raw.total ? Math.round(raw.matched / raw.total * 100) : 0,
    avg_rate: raw.rate_count ? Math.round(raw.rate_sum / raw.rate_count) : null,
    top_lanes,
    monthly,
    // underscore-prefixed fields survive for future merges
    _rate_sum: raw.rate_sum,
    _rate_count: raw.rate_count,
    _lane_counts: raw.lane_counts,
    _monthly_raw: raw.monthly_raw,
  };
}

function mergeInto(existing, incoming) {
  // Merge two raw aggregate objects in-place into existing
  existing.total += incoming.total;
  existing.matched += incoming.matched;
  existing.rate_sum += incoming.rate_sum;
  existing.rate_count += incoming.rate_count;

  for (const [lane, cnt] of Object.entries(incoming.lane_counts)) {
    existing.lane_counts[lane] = (existing.lane_counts[lane] || 0) + cnt;
  }

  for (const [month, m] of Object.entries(incoming.monthly_raw)) {
    const ex = existing.monthly_raw[month] || (existing.monthly_raw[month] = { total: 0, matched: 0 });
    ex.total += m.total;
    ex.matched += m.matched;
  }
}

// ── Blob helpers ────────────────────────────────────────────────────────────

async function loadStats(store) {
  const raw = await store.get('all-office-stats', { type: 'json' }).catch(() => null);
  return raw || {};
}

async function saveStats(store, stats) {
  await store.set('all-office-stats', JSON.stringify(stats));
}

async function loadMeta(store) {
  const raw = await store.get('meta', { type: 'json' }).catch(() => null);
  return raw || {};
}

async function saveMeta(store, meta) {
  await store.set('meta', JSON.stringify(meta));
}

// ── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req) {
  const secret = process.env.UPLOAD_SECRET;
  if (!secret) return true;
  const header = req.headers.get('x-upload-secret') || req.headers.get('authorization') || '';
  return header === secret || header === `Bearer ${secret}`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Secret, Authorization',
  'Cache-Control': 'no-store',
};

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  const url = new URL(req.url);
  // pathname: /api/office-stats/TX-123  →  parts after /api/
  const parts = url.pathname.replace(/^\/+api\/?/, '').split('/').filter(Boolean);
  const endpoint = parts[0] || '';
  const param = parts.slice(1).join('/');
  const method = req.method;

  const store = getStore(STORE_NAME);

  try {
    // GET /api/health
    if (method === 'GET' && endpoint === 'health') {
      const meta = await loadMeta(store);
      return Response.json({
        status: 'ok',
        last_upload: meta.last_upload || null,
        record_count: meta.record_count || 0,
        office_count: meta.office_count || 0,
        append_count: meta.append_count || 0,
      }, { headers: JSON_HEADERS });
    }

    // GET /api/office-stats  (all offices summary)
    if (method === 'GET' && endpoint === 'office-stats' && !param) {
      const stored = await loadStats(store);
      // Return display-only fields (strip underscore fields)
      const summary = {};
      for (const [id, s] of Object.entries(stored)) {
        summary[id] = {
          office_id: s.office_id,
          office_name: s.office_name,
          total_loads: s.total_loads,
          matched_loads: s.matched_loads,
          match_rate: s.match_rate,
          avg_rate: s.avg_rate,
        };
      }
      return Response.json(summary, { headers: JSON_HEADERS });
    }

    // GET /api/office-stats/:id  (single office drill-down)
    if (method === 'GET' && endpoint === 'office-stats' && param) {
      const stored = await loadStats(store);
      const id = decodeURIComponent(param);
      const office = stored[id];
      if (!office) {
        return Response.json({ error: 'Not found', office_id: id }, { status: 404, headers: JSON_HEADERS });
      }
      // Return full details, strip internal merge fields
      const { _rate_sum, _rate_count, _lane_counts, _monthly_raw, ...display } = office;
      return Response.json(display, { headers: JSON_HEADERS });
    }

    // POST /api/upload
    if (method === 'POST' && endpoint === 'upload') {
      if (!isAuthorized(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: JSON_HEADERS });
      }

      const mode = url.searchParams.get('mode') || 'replace'; // 'replace' | 'append'
      const contentType = req.headers.get('content-type') || '';

      // Parse incoming records
      let normalizedRows;
      if (contentType.includes('application/json')) {
        const body = await req.json();
        const arr = Array.isArray(body) ? body : (body.records || body.data || [body]);
        normalizedRows = arr.map(normalizeRow);
      } else {
        const text = await req.text();
        normalizedRows = parseCsv(text).map(normalizeRow);
      }

      const validRows = normalizedRows.filter(r => r.office_id || r.office_name);
      if (!validRows.length) {
        return Response.json({ error: 'No valid records — each row needs office_id or office_name' }, { status: 400, headers: JSON_HEADERS });
      }

      // Compute raw aggregates for incoming batch
      const incomingRaw = computeOfficeStats(validRows);

      let finalStats;
      let appendCount = 0;

      if (mode === 'append') {
        // Load existing stored stats and merge
        const existingStored = await loadStats(store);
        const mergedRaw = {};

        // Start from existing, reconstructing raw aggregate shape
        for (const [id, s] of Object.entries(existingStored)) {
          mergedRaw[id] = {
            office_id: s.office_id,
            office_name: s.office_name,
            total: s.total_loads || 0,
            matched: s.matched_loads || 0,
            rate_sum: s._rate_sum || 0,
            rate_count: s._rate_count || 0,
            lane_counts: s._lane_counts || {},
            monthly_raw: s._monthly_raw || {},
          };
        }

        // Merge incoming into existing
        for (const [id, incoming] of Object.entries(incomingRaw)) {
          if (mergedRaw[id]) {
            mergeInto(mergedRaw[id], incoming);
          } else {
            mergedRaw[id] = incoming;
          }
        }

        finalStats = {};
        for (const [id, raw] of Object.entries(mergedRaw)) {
          finalStats[id] = deriveDisplayFields(raw);
        }

        const existingMeta = await loadMeta(store);
        appendCount = (existingMeta.append_count || 0) + 1;
      } else {
        // Replace: discard existing data
        finalStats = {};
        for (const [id, raw] of Object.entries(incomingRaw)) {
          finalStats[id] = deriveDisplayFields(raw);
        }
        appendCount = 0;
      }

      await saveStats(store, finalStats);
      await saveMeta(store, {
        last_upload: new Date().toISOString(),
        upload_mode: mode,
        record_count: validRows.length,
        office_count: Object.keys(finalStats).length,
        append_count: appendCount,
      });

      return Response.json({
        ok: true,
        mode,
        records_processed: validRows.length,
        offices: Object.keys(finalStats).length,
      }, { headers: JSON_HEADERS });
    }

    // POST /api/clear
    if (method === 'POST' && endpoint === 'clear') {
      if (!isAuthorized(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: JSON_HEADERS });
      }
      await store.delete('all-office-stats').catch(() => null);
      await store.delete('meta').catch(() => null);
      return Response.json({ ok: true, cleared: true }, { headers: JSON_HEADERS });
    }

    return Response.json({ error: `Unknown route: ${method} /api/${endpoint}` }, { status: 404, headers: JSON_HEADERS });

  } catch (err) {
    console.error('[mode-iq-api]', err);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500, headers: JSON_HEADERS });
  }
};

export const config = {
  path: '/api/:rest*',
};
