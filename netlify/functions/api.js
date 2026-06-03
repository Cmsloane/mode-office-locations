// MODE IQ Office Analytics — Netlify Function backend
// Ingests Power BI CSV exports and serves per-office load stats

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'mode-iq-analytics';
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || '';

// IBO code → canonical map pin ID.
// Generated from the OFFICES array in index.html — covers numeric suffixes,
// full IBO codes, and alpha-only codes. Update when offices are added/renamed.
const IBO_MAP = {"104":"104","108":"108","112":"112","114":"114","132":"(132) (WA-CI132)","137":"137","143":"143","176":"802;176","177":"177","194":"194","197":"197","217":"512; 217; 713","233":"233","234":"234; 237","236":"236","237":"234; 237","249":"249","253":"253","260":"(260) (TX-ST260)","264":"264","265":"265","272":"272;273","273":"272;273","276":"276","289":"289","299":"299","312":"312","319":"319","322":"322","324":"324","328":"328","352":"352","358":"358","364":"364","391":"391;714","409":"409; 660","426":"426","427":"(427) (TX-HU427)","430":"(414) (430)","436":"436","451":"451","452":"452","453":"453","468":"468","472":"472","482":"482","502":"502","505":"505","512":"512; 217; 713","519":"(519)  (TX-FA519)","520":"520","522":"522","524":"524;925","531":"531","544":"544; 790","550":"550","580":"371","605":"425","657":"657; 712","659":"659","663":"663","664":"664","713":"512; 217; 713","714":"391;714","724":"724","729":"144;424;604;729","735":"735","743":"743; 756","756":"743; 756","761":"761","773":"773","785":"785","790":"544; 790","802":"802;176","805":"805","806":"806","816":"816","818":"818","821":"821","851":"851","853":"853","865":"865","873":"873","874":"874","891":"891","893":"893","896":"896","913":"913","918":"918","923":"923; 366","925":"524;925","940":"940","941":"941","943":"943","948":"(948) (ID-VA948)","950":"950","954":"524;925","965":"TX-MO965","AA":"NJ-AA","ABI":"TX-ABI","AG":"GA-AG","AIN":"IN-AIN","AL-BA":"AL-BA;ALBA-M;TN-BA","AL-DM":"AL-DM","AL-HO923":"923; 366","AL-PE663":"663","AR-GE104":"104","AZ-ES194":"194","AZ-PO505":"505","AZ-RI108":"108","AZ-TUA":"AZ-TUA","BA":"AL-BA;ALBA-M;TN-BA","BD":"MS-BD/ET-MSBD/MJ-TX/MO-RM/MS-JM/MS-KK/MS-MC/TN-RR","BJ":"FL-BJ","BPA":"PA-BPA","CA-HU524":"524;925","CA-HU785":"785","CA-HU925":"524;925","CA-JA472":"472","CA-JO112":"112","CA-KA896":"896","CA-KU659":"659","CA-KU773":"773","CA-MI197":"197","CA-NLL":"CA-NLL","CA-PA352":"352","CA-VE177":"177","CA-VJ":"Ca-VJ","CA-VO468":"468","CB":"NY-CB","CGA":"GA-CGA","CM":"SC-CM","CO-BO451":"451","CO-KU265":"265","CS":"NC-CS","DCO":"IN-DCO","DJR":"TX-DJR","DM":"AL-DM","DR":"SC-DR","DS":"NY-DS","ET-MSBD":"MS-BD/ET-MSBD/MJ-TX/MO-RM/MS-JM/MS-KK/MS-MC/TN-RR","ET-SF":"FL-SF","ET-UTS":"FL-UTS; ET-UTS","FL-BJ":"FL-BJ","FL-CO664":"664","FL-HJB":"FL-HJB; FL-WPCC; FL-TH;VA-KB","FL-JH":"FL-JH","FL-JS":"FL-JS","FL-KI943":"943","FL-PA276":"276","FL-PE950":"950","FL-SF":"FL-SF","FL-SN873":"873","FL-SP851":"851","FL-TH":"FL-HJB; FL-WPCC; FL-TH;VA-KB","FL-UTS":"FL-UTS; ET-UTS","FL-WC":"FL-WC","FL-WE324":"324","FL-WPPC":"FL-HJB; FL-WPCC; FL-TH;VA-KB","GA-AG":"GA-AG","GA-CGA":"GA-CGA","GA-CH550":"550","GA-LE544":"544; 790","GA-LE790":"544; 790","GA-WGA":"GA-WGA","GH":"KS-GH","GMO":"MO-GMO","HJB":"FL-HJB; FL-WPCC; FL-TH;VA-KB","IA-AN874":"874","ID-JGT":"ID-JGT","ID-VA948":"(948) (ID-VA948)","IL-C714":"391;714","IL-JJ":"IL-JJ","IL-KL312":"312","IL-PA816":"816","IL-TH236":"236","IN-AIN":"IN-AIN","IN-DCO":"IN-DCO","IN-MIN":"IN-MIN","ITX":"TX-ITX","JGT":"ID-JGT","JH":"FL-JH","JJ":"TX-JJ","JP":"MD-JP","JS":"FL-JS","JT":"SC-JT","JY":"TX-JY","KC":"SC-KC","KS-GH":"KS-GH","LA-CR143":"143","LA-DA328":"328","LVL":"NV-LVL","LY":"TX-LY","MA-MA452":"452","MA-VE735":"735","MD-JP":"MD-JP","ME-PPM":"ME-PPM","MI-RK":"MI-RK","MI-TH941":"941","MIN":"IN-MIN","MJ-TX":"MS-BD/ET-MSBD/MJ-TX/MO-RM/MS-JM/MS-KK/MS-MC/TN-RR","MN-BA482":"482","MN-HA264":"264","MO-GMO":"MO-GMO","MO-PE409":"409; 660","MO-SUN":"MO-SUN","MS-BD":"MS-BD/ET-MSBD/MJ-TX/MO-RM/MS-JM/MS-KK/MS-MC/TN-RR","MS-CO891":"891","MS-WR818":"818","MSBD":"MS-BD/ET-MSBD/MJ-TX/MO-RM/MS-JM/MS-KK/MS-MC/TN-RR","NC-CS":"NC-CS","NC-KU436":"436","NJ-AA":"NJ-AA","NJ-CA249":"249","NJ-KU520":"520","NLL":"CA-NLL","NV-756":"743; 756","NV-DA743":"743; 756","NV-LVL":"NV-LVL","NY-CB":"NY-CB","NY-DA940":"940","NY-DS":"NY-DS","OAK":"OK-OAK","OH-PRI":"OH-PRI;DE-HOF","OH-TD":"OH-TD","OK-OAK":"OK-OAK","ON-BI272":"272;273","ON-BI273":"272;273","ON-KE657":"657; 712","ON-SA234":"234; 237","ON-SA237":"234; 237","OR-PA137":"137","PA-BPA":"PA-BPA","PA-KU319":"319","PA-KU729":"144;424;604;729","PA-KU918":"918","PA-LA580":"371","PPM":"ME-PPM","PRI":"OH-PRI;DE-HOF","PW":"SC-PW","RB":"TN-RB","RED":"TX-RED","RK":"MI-RK","RM":"TN-RM","SC-BO453":"453","SC-CM":"SC-CM","SC-DR":"SC-DR","SC-JT":"SC-JT","SC-KC":"SC-KC","SC-PW":"SC-PW","SEA":"WA-SEA","SF":"FL-SF","SUN":"MO-SUN","SWA":"WA-SWA","TD":"OH-TD","TH":"FL-HJB; FL-WPCC; FL-TH;VA-KB","TN-KU821":"821","TN-OL805":"805","TN-RB":"TN-RB","TN-RM":"TN-RM","TN-SA531":"531","TN-WH430":"(414) (430)","TUA":"AZ-TUA","TX":"MS-BD/ET-MSBD/MJ-TX/MO-RM/MS-JM/MS-KK/MS-MC/TN-RR","TX-ABI":"TX-ABI","TX-AD217":"512; 217; 713","TX-AD512":"512; 217; 713","TX-AL853":"853","TX-BU253":"253","TX-CH522":"522","TX-CO605":"425","TX-DJR":"TX-DJR","TX-FA519":"(519)  (TX-FA519)","TX-FE426":"426","TX-FO806":"806","TX-GI176":"802;176","TX-GI802":"802;176","TX-HA299":"299","TX-HU427":"(427) (TX-HU427)","TX-ITX":"TX-ITX","TX-JJ":"TX-JJ","TX-JY":"TX-JY","TX-LY":"TX-LY","TX-MI913":"913","TX-MO965":"TX-MO965","TX-PO865":"865","TX-RED":"TX-RED","TX-RI724":"724","TX-SH233":"233","TX-SP893":"893","TX-ST260":"(260) (TX-ST260)","TX-WA761":"761","TX-WLM":"TX-WLM;TX-WMZ","TX-WMZ":"TX-WLM;TX-WMZ","UTS":"FL-UTS; ET-UTS","VA-HA364":"364","VJ":"Ca-VJ","WA-BL114":"114","WA-CI132":"(132) (WA-CI132)","WA-CO322":"322","WA-SEA":"WA-SEA","WA-SWA":"WA-SWA","WC":"FL-WC","WGA":"GA-WGA","WI-FE502":"502","WLM":"TX-WLM;TX-WMZ","WMZ":"TX-WLM;TX-WMZ","WPPC":"FL-HJB; FL-WPCC; FL-TH;VA-KB","WV-EL289":"289"};

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

// Resolve an IBO code to its canonical map pin ID using IBO_MAP.
// Tries: (1) direct lookup, (2) numeric suffix, (3) alpha suffix.
// Falls back to the raw code if nothing matches.
function resolveIBO(ibo) {
  if (!ibo) return ibo;
  if (IBO_MAP[ibo]) return IBO_MAP[ibo];
  const numSuffix = ibo.match(/(\d+)$/);
  if (numSuffix && IBO_MAP[numSuffix[1]]) return IBO_MAP[numSuffix[1]];
  const alphaSuffix = ibo.match(/([A-Za-z]+)$/);
  if (alphaSuffix && IBO_MAP[alphaSuffix[1].toUpperCase()]) return IBO_MAP[alphaSuffix[1].toUpperCase()];
  return ibo;
}

// Normalise a raw Power BI row into our internal load record.
// Supports both aggregated lane report format (IBO, Lane, Volume, Avg Revenue, Profit %)
// and per-load match format (office_id, origin_state, dest_state, match_status, rate).
function normaliseRow(row) {
  const g = (...keys) => {
    for (const k of keys) {
      const v = row[k] || row[k.replace(/_/g, ' ')] || '';
      if (v) return v.trim();
    }
    return '';
  };

  // Office identification — IBO → resolved canonical map pin ID
  const raw_ibo = g('ibo', 'office_id', 'office', 'branch_id', 'branch', 'location_id', 'location');
  const office_id = raw_ibo ? resolveIBO(raw_ibo) : '';
  const office_name = g('ibo_group_name', 'office_name', 'branch_name', 'location_name');

  // Lane: direct state columns first, then parse Lane string
  let origin_state = g('origin_state', 'pickup_state', 'o_state');
  let dest_state   = g('dest_state', 'destination_state', 'delivery_state', 'd_state');
  if (!origin_state || !dest_state) {
    const parsed = parseLane(g('lane'));
    if (!origin_state) origin_state = parsed.origin_state;
    if (!dest_state)   dest_state   = parsed.dest_state;
  }

  // Volume: each row may represent N loads in aggregated reports
  const volumeRaw = g('volume').replace(/[,\s]/g, '');
  const volume = parseInt(volumeRaw, 10) || 1;

  // Match status: explicit column takes priority; absent → infer matched for rows with revenue
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
    matched = (volume > 1 || !!g('avg_revenue', 'total_revenue', 'rate')) ? true : null;
  }

  // Rate: avg_revenue for lane reports, per-load rate otherwise
  const rateRaw = g('avg_revenue', 'rate', 'load_rate', 'total_rate', 'buy_rate').replace(/[$,\s]/g, '');
  const rate = parseFloat(rateRaw) || null;

  // Profit margin (from lane reports; "Profit %" header normalises to "profit_")
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

// Derive summary fields from raw accumulator dicts.
function summarise(o) {
  o.match_rate     = o.total    ? Math.round((o.matched / o.total) * 100) : 0;
  o.avg_rate       = o._rates_n ? Math.round(o._rates_sum   / o._rates_n) : null;
  o.avg_miles      = o._miles_n ? Math.round(o._miles_sum   / o._miles_n) : null;
  o.avg_profit_pct = o._profit_n ? Math.round((o._profit_sum / o._profit_n) * 10) / 10 : null;

  o.top_lanes = Object.entries(o._lanes || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([lane, count]) => { const [orig, dest] = lane.split('→'); return { orig, dest, count }; });

  o.top_carriers = Object.entries(o._carriers || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  o.monthly_trend = Object.entries(o._by_month || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, count]) => ({ month, count }));

  o.equipment = o._equipment || {};
}

// Aggregate normalised records into per-office stats.
// Volume multiplies all counters so aggregated lane rows are handled correctly.
function computeStats(records) {
  const offices = {};

  for (const r of records) {
    const key = r.office_id || r.office_name || 'unknown';
    if (!offices[key]) {
      offices[key] = {
        office_id:   r.office_id,
        office_name: r.office_name,
        total: 0, matched: 0, unmatched: 0, unknown: 0,
        _rates_sum: 0, _rates_n: 0,
        _miles_sum: 0, _miles_n: 0,
        _profit_sum: 0, _profit_n: 0,
        _lanes: {}, _equipment: {}, _by_month: {}, _carriers: {},
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

  for (const o of Object.values(offices)) summarise(o);
  return offices;
}

// Merge a fresh office entry on top of existing (append mode).
function mergeOffice(existing, fresh) {
  const merged = {
    office_id:   fresh.office_id   || existing.office_id,
    office_name: fresh.office_name || existing.office_name,
    total:       existing.total     + fresh.total,
    matched:     existing.matched   + fresh.matched,
    unmatched:   existing.unmatched + fresh.unmatched,
    unknown:     existing.unknown   + fresh.unknown,
    _rates_sum:  (existing._rates_sum  || 0) + (fresh._rates_sum  || 0),
    _rates_n:    (existing._rates_n    || 0) + (fresh._rates_n    || 0),
    _miles_sum:  (existing._miles_sum  || 0) + (fresh._miles_sum  || 0),
    _miles_n:    (existing._miles_n    || 0) + (fresh._miles_n    || 0),
    _profit_sum: (existing._profit_sum || 0) + (fresh._profit_sum || 0),
    _profit_n:   (existing._profit_n   || 0) + (fresh._profit_n   || 0),
    _lanes:     { ...(existing._lanes     || {}) },
    _equipment: { ...(existing._equipment || {}) },
    _by_month:  { ...(existing._by_month  || {}) },
    _carriers:  { ...(existing._carriers  || {}) },
  };
  for (const [k, v] of Object.entries(fresh._lanes     || {})) merged._lanes[k]     = (merged._lanes[k]     || 0) + v;
  for (const [k, v] of Object.entries(fresh._equipment || {})) merged._equipment[k] = (merged._equipment[k] || 0) + v;
  for (const [k, v] of Object.entries(fresh._by_month  || {})) merged._by_month[k]  = (merged._by_month[k]  || 0) + v;
  for (const [k, v] of Object.entries(fresh._carriers  || {})) merged._carriers[k]  = (merged._carriers[k]  || 0) + v;
  summarise(merged);
  return merged;
}

// ─── route handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const { httpMethod: method, path, body, headers, queryStringParameters: qs } = event;
  const seg = path.replace(/^\/\.netlify\/functions\/api\/?/, '').replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const route = seg[0] || '';
  const param = seg.slice(1).join('/') || '';

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

  // GET /api/office-stats
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

  // GET /api/office-stats/:id
  if (method === 'GET' && route === 'office-stats' && param) {
    const s = store();
    try {
      const raw = await s.get('all-office-stats');
      if (!raw) return json({ error: 'No data uploaded yet.' }, 404);
      const all = JSON.parse(raw);

      // Resolve the query ID the same way uploads are resolved, then do exact lookup
      const decoded = decodeURIComponent(param);
      const resolved = resolveIBO(decoded);
      const match = all[resolved] || all[decoded];
      if (match) return json(match);

      return json({ error: `Office "${param}" not found.` }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  // POST /api/upload
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

  // POST /api/clear
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
