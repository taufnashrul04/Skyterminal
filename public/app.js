import { normalizePanelState, setPanelCollapsed } from './panel-state.js';

const ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];
const WORKSPACES = {
  core: { label: 'CORE MARKET INTEL', mode: 'market', asset: 'BTC', timeframe: '5m' },
  'bad-good-hands': { label: 'BTC BAD / GOOD HANDS', mode: 'market', asset: 'BTC', timeframe: '5m' },
  'liquidation-farming': { label: 'ALTS LIQUIDATION FARMING', mode: 'liquidation', asset: 'BTC', timeframe: '5m' },
  'sdelta-linear': { label: 'SCALP SDELTA · LINEAR', mode: 'market', asset: 'BTC', timeframe: '5m' },
  'sdelta-inverse': { label: 'SCALP SDELTA · INVERSE', mode: 'market', asset: 'BTC', timeframe: '5m' },
  'stpo-extreme': { label: 'STPO EXTREME', mode: 'market', asset: 'BTC', timeframe: '15m' },
  'volume-pocket': { label: 'DVOL POCKET', mode: 'market', asset: 'BTC', timeframe: '5m' },
  'range-charting': { label: 'RANGE CHARTING', mode: 'market', asset: 'BTC', timeframe: '5m' },
  'tpo-volume': { label: 'TPO / VOLUME PROFILE', mode: 'market', asset: 'BTC', timeframe: '1h' },
};
const state = { mode: 'market', workspace: 'core', asset: 'BTC', timeframe: '5m', liquidationWindow: '15m', liquidationSide: 'all', market: null, collector: null, funding: null, liquidations: null, mids: {}, matrix: {}, busy: false };
let marketGeneration = 0;
let matrixGeneration = 0;
let fundingGeneration = 0;
let collectorGeneration = 0;
let collectorLiveBusy = false;

const $ = (selector) => document.querySelector(selector);
const fmtPrice = (value) => Number(value).toLocaleString('en-US', { minimumFractionDigits: Number(value) < 100 ? 2 : 1, maximumFractionDigits: Number(value) < 10 ? 4 : 2 });
const pct = (value, digits = 2) => `${value >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(digits)}%`;
const number = (value, digits = 2) => Number(value).toFixed(digits);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const compactUSD = (value) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const compactNumber = (value) => Number(value).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function setStatus(message, kind = 'live') {
  $('#statusMessage').textContent = message;
  $('#connectionLabel').textContent = kind === 'error' ? 'DEGRADED' : kind === 'pending' ? 'SYNCING' : 'LIVE';
  $('#liveDot').className = `live-dot ${kind}`;
}

const PANEL_STATE_KEY = 'skyterminal.panel-state.v1';

function readPanelState() {
  try { return normalizePanelState(JSON.parse(localStorage.getItem(PANEL_STATE_KEY) || '{}')); }
  catch { return {}; }
}

function setupCollapsiblePanels() {
  let saved = readPanelState();
  document.querySelectorAll('.panel').forEach((panel, index) => {
    const header = panel.querySelector(':scope > .panel-head');
    if (!header) return;
    const panelId = panel.dataset.panelId || [...panel.classList].find((name) => name !== 'panel') || `panel-${index}`;
    panel.dataset.panelId = panelId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-toggle';
    button.setAttribute('aria-label', `Toggle ${panelId.replaceAll('-', ' ')}`);
    header.append(button);
    const apply = (collapsed) => {
      panel.classList.toggle('collapsed', collapsed);
      button.textContent = collapsed ? '+' : '−';
      button.setAttribute('aria-expanded', String(!collapsed));
      button.title = collapsed ? 'Expand section' : 'Minimize section';
    };
    apply(Boolean(saved[panelId]));
    const toggle = () => {
      const collapsed = !panel.classList.contains('collapsed');
      apply(collapsed);
      saved = setPanelCollapsed(saved, panelId, collapsed);
      try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(saved)); }
      catch { /* Storage can be disabled; panel behavior still works for this page. */ }
    };
    button.addEventListener('click', (event) => { event.stopPropagation(); toggle(); });
    header.addEventListener('click', (event) => {
      if (event.target.closest('button, input, select, label, a')) return;
      toggle();
    });
  });
}

async function getJSON(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function renderTabs() {
  $('#assetTabs').innerHTML = ASSETS.map((asset) => `<button class="tab ${asset === state.asset ? 'active' : ''}" data-asset="${asset}">${asset}</button>`).join('');
  $('#timeframeTabs').innerHTML = TIMEFRAMES.map((tf) => `<button class="tab ${tf === state.timeframe ? 'active' : ''}" data-timeframe="${tf}">${tf.toUpperCase()}</button>`).join('');
  document.querySelectorAll('[data-asset]').forEach((button) => button.addEventListener('click', () => selectAsset(button.dataset.asset)));
  document.querySelectorAll('[data-timeframe]').forEach((button) => button.addEventListener('click', () => selectTimeframe(button.dataset.timeframe)));
}

function selectAsset(asset) {
  if (!ASSETS.includes(asset)) return;
  state.asset = asset; state.matrix = {}; renderTabs();
  if (state.mode === 'liquidation') loadLiquidations();
  else if (state.mode === 'funding') loadFunding();
  else loadAll();
}
function selectTimeframe(timeframe) {
  if (!TIMEFRAMES.includes(timeframe)) return;
  state.timeframe = timeframe; renderTabs(); loadMarket();
}

function selectWorkspace(id) {
  const workspace = WORKSPACES[id];
  if (!workspace) return;
  state.workspace = id;
  $('#workspaceSelect').value = id;
  if (workspace.asset !== state.asset) selectAsset(workspace.asset);
  if (workspace.timeframe !== state.timeframe) selectTimeframe(workspace.timeframe);
  selectMode(workspace.mode);
  setStatus(`${workspace.label} LOADED`, 'live');
}

function selectMode(mode) {
  if (!['market', 'funding', 'liquidation'].includes(mode)) return;
  state.mode = mode;
  marketGeneration += 1;
  matrixGeneration += 1;
  fundingGeneration += 1;
  $('#marketDashboard').hidden = mode !== 'market';
  $('#fundingDashboard').hidden = mode !== 'funding';
  $('#liquidationDashboard').hidden = mode !== 'liquidation';
  $('#assetTabs').hidden = mode === 'funding';
  $('#timeframeTabs').hidden = mode !== 'market';
  document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  if (mode === 'funding') loadFunding();
  else if (mode === 'liquidation') loadLiquidations();
  else loadAll();
}

function regimeFrom(percentile, trend) {
  if (percentile >= 80) return { code: 'R3', label: trend >= 0 ? 'HIGH-VOL EXPANSION' : 'HIGH-VOL PRESSURE', text: 'Dispersion is elevated. Reduce leverage assumptions and expect wider execution ranges.' };
  if (percentile <= 20) return { code: 'R1', label: 'VOLATILITY COMPRESSION', text: 'Range is compressed. Watch for expansion, but do not infer its direction.' };
  return { code: 'R2', label: trend >= .35 ? 'ORDERED ADVANCE' : trend <= -.35 ? 'ORDERED DECLINE' : 'BALANCED AUCTION', text: 'Volatility sits in its normal band. Direction depends on price and flow alignment.' };
}

function renderMarket(data) {
  state.market = data;
  const m = data.metrics;
  $('#instrument').textContent = data.asset;
  $('#price').textContent = `$${fmtPrice(data.price)}`;
  $('#change').textContent = pct(data.change);
  $('#change').className = `change ${data.change >= 0 ? 'up' : 'down'}`;
  $('#asOf').textContent = new Date(data.asOf).toLocaleString(undefined, { hour12: false });
  $('#qualityBadge').textContent = data.quality.stale ? 'STALE' : `${data.quality.sampleSize} BARS`;
  $('#qualityBadge').className = `quality ${data.quality.stale ? 'bad' : 'good'}`;
  $('#chartRange').textContent = `${data.asset} · ${data.timeframe.toUpperCase()} · ${data.venue}`;
  const regime = regimeFrom(m.volatilityPercentile, m.trend);
  $('#regimeCode').textContent = regime.code;
  $('#regimeValue').textContent = Math.round(m.volatilityPercentile);
  $('#regimeLabel').textContent = regime.label;
  $('#regimeDescription').textContent = regime.text;
  $('#regimeOrbit').style.setProperty('--regime', `${m.volatilityPercentile}%`);
  $('#regimeMetrics').innerHTML = [
    ['TREND / FAST', signedScore(m.trend)], ['TREND / SLOW', signedScore(m.trendSlow)],
    ['REALIZED VOL', `${(m.volatility * 100).toFixed(1)}% ann.`], ['BOOK PRESSURE', pressureLabel(m.bookImbalance)],
  ].map(([label, value]) => `<div class="metric-row"><span>${label}</span><b>${value}</b></div>`).join('');
  $('#imbalance').textContent = `${m.bookImbalance >= 0 ? 'BID' : 'ASK'} ${Math.abs(m.bookImbalance * 100).toFixed(1)}%`;
  $('#spread').textContent = `${m.spreadBps.toFixed(2)} BPS`;
  renderRisk(data);
  renderExo(data);
  renderPriceChart($('#priceChart'), data.series.candles);
  renderLineChart($('#deltaChart'), data.series.cumulativeDelta, m.bookImbalance >= 0 ? '#62e6a7' : '#ff5f68');
}

function signedScore(value) { return `${value >= 0 ? '+' : ''}${number(value)}`; }
function pressureLabel(value) { return Math.abs(value) < .08 ? 'BALANCED' : `${value > 0 ? 'BID' : 'ASK'} ${(Math.abs(value) * 100).toFixed(0)}%`; }

function renderRisk(data) {
  const m = data.metrics;
  const items = [
    ['DRAWDOWN', Math.abs(m.drawdown), pct(m.drawdown)],
    ['VALUE AT RISK', m.var95, pct(-m.var95)],
    ['EXPECTED SHORTFALL', m.es95, pct(-m.es95)],
    ['SPREAD COST', Math.min(m.spreadBps / 100, 1), `${m.spreadBps.toFixed(2)} bps`],
  ];
  $('#riskStack').innerHTML = items.map(([label, raw, display]) => `<div class="risk-item"><div class="risk-line"><span>${label}</span><b>${display}</b></div><div class="risk-track"><i style="width:${clamp(raw * 500, 2, 100)}%"></i></div></div>`).join('');
}

function renderExo(data) {
  const exo = data.exo;
  if (!exo) return;
  const profile = exo.profile ?? { bins: [] };
  const maxVolume = Math.max(...profile.bins.map((bin) => bin.volume), 1);
  $('#volumeProfile').innerHTML = profile.available ? [...profile.bins].reverse().map((bin) => {
    const isPoc = Math.abs(bin.price - profile.poc) <= Math.max(Math.abs(profile.poc) * 1e-10, 1e-10);
    return `<div class="profile-row ${isPoc ? 'poc' : ''}"><span>${fmtPrice(bin.price)}</span><div class="profile-bar"><i style="width:${clamp(bin.volume / maxVolume * 100, 0, 100)}%"></i></div><b>${isPoc ? 'POC' : compactNumber(bin.volume)}</b></div>`;
  }).join('') : '<div class="empty-cell">PROFILE UNAVAILABLE · ZERO VOLUME</div>';
  const flow = exo.recentFlow;
  const deltaClass = flow.deltaNotional > 0 ? 'positive' : flow.deltaNotional < 0 ? 'negative' : '';
  const deltaSide = flow.deltaNotional > 0 ? 'BUY' : flow.deltaNotional < 0 ? 'SELL' : 'FLAT';
  const absorption = String(exo.absorptionProxy ?? 'UNAVAILABLE').replaceAll('_', ' ');
  const cards = [
    ['PROFILE POC', profile.available ? `$${fmtPrice(profile.poc)}` : 'N/A', `${data.timeframe.toUpperCase()} CANDLE PROFILE`, ''],
    ['VALUE AREA 70%', profile.available ? `$${fmtPrice(profile.val)} – $${fmtPrice(profile.vah)}` : 'N/A', 'VAL → VAH', ''],
    ['WINDOW VWAP', `$${fmtPrice(exo.session.vwap)}`, `HIGH $${fmtPrice(exo.session.high)} / LOW $${fmtPrice(exo.session.low)}`, ''],
    ['WINDOW RANGE', pct(exo.session.rangePct), `${data.quality.sampleSize} BARS`, ''],
    ['RECENT TRADE DELTA', `${deltaSide} ${compactUSD(Math.abs(flow.deltaNotional))}`, `${flow.count} PUBLIC PRINTS`, deltaClass],
    ['TRADE IMBALANCE', pct(flow.imbalance), `${compactUSD(flow.buyNotional)} BUY / ${compactUSD(flow.sellNotional)} SELL`, deltaClass],
    ['ABSORPTION CHECK', absorption, 'PRICE RESPONSE PROXY', 'proxy'],
    ['PROFILE METHOD', 'CANDLE PROXY', 'NOT TRADE-AT-PRICE FOOTPRINT', 'proxy'],
  ];
  $('#exoMetrics').innerHTML = cards.map(([label, value, detail, cls]) => `<article class="exo-card ${cls}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`).join('');
}

function renderCollectorSummary(summary) {
  state.collector = summary;
  if (!state.market) return;
  const existing = [...document.querySelectorAll('#exoLiveMetrics .collector-card')];
  existing.forEach((node) => node.remove());
  const health = summary?.available ? summary.health?.data : null;
  const rows = summary?.available ? [
    ['CVD — AGGREGATE SPOT + PERP', summary.analytics?.cvd?.buckets?.at(-1)?.close ?? 'N/A', 'BINANCE · BYBIT · OKX · HYPERLIQUID', 'collector-card'],
    ['TRUE PROFILE POC', summary.analytics?.profile?.poc ?? 'N/A', 'TRADE-AT-PRICE', 'collector-card'],
    ['TPO POC', summary.analytics?.tpo?.poc ?? 'N/A', '30M MARKET PROFILE', 'collector-card'],
    ['LIQUIDATION FLOW', `${summary.analytics?.liquidations?.totals?.long ?? '0'} LONG / ${summary.analytics?.liquidations?.totals?.short ?? '0'} SHORT`, 'GROSS · NOTIONAL N/A', 'collector-card'],
    ['OKX LIQUIDATIONS', (() => { const source = health?.sources?.find((item) => item.source === 'okx-liquidations'); return source?.status === 'connected' ? 'CONNECTED' : source?.last_event_us ? 'DEGRADED' : 'NO RECENT EVENTS'; })(), 'SWAP · LIQUIDATION-ORDERS', 'collector-card'],
    ['COLLECTOR STATUS', health?.status?.toUpperCase() ?? 'ONLINE', `${health?.counts?.trades ?? 0} TRADES STORED`, 'collector-card'],
  ] : [['COLLECTOR STATUS', 'OFFLINE', summary?.error ? 'LOCAL COLLECTOR UNAVAILABLE' : 'WAITING FOR DATA', 'collector-card proxy']];
  $('#exoLiveMetrics').innerHTML = rows.map(([label, value, detail, cls]) => `<article class="exo-card ${cls}"><span>${label}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`).join('');
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * ratio)); canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); return { ctx, width: rect.width, height: rect.height };
}

function renderPriceChart(canvas, candles) {
  const { ctx, width, height } = resizeCanvas(canvas); ctx.clearRect(0, 0, width, height);
  if (!candles?.length) return;
  const pad = { l: 14, r: 58, t: 22, b: 42 }; const volumeHeight = 62; const chartBottom = height - pad.b - volumeHeight;
  const highs = candles.map((c) => c.h), lows = candles.map((c) => c.l); const max = Math.max(...highs), min = Math.min(...lows); const range = max - min || 1;
  const step = (width - pad.l - pad.r) / candles.length; const body = Math.max(1, Math.min(7, step * .62)); const maxV = Math.max(...candles.map((c) => c.v), 1);
  const y = (price) => pad.t + ((max - price) / range) * (chartBottom - pad.t);
  candles.forEach((c, index) => {
    const x = pad.l + index * step + step / 2; const up = c.c >= c.o; const color = up ? '#62e6a7' : '#ff5f68';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.globalAlpha = .9; ctx.beginPath(); ctx.moveTo(x, y(c.h)); ctx.lineTo(x, y(c.l)); ctx.stroke();
    const top = Math.min(y(c.o), y(c.c)); const h = Math.max(1, Math.abs(y(c.o) - y(c.c))); ctx.fillRect(x - body / 2, top, body, h);
    ctx.globalAlpha = .28; const vh = (c.v / maxV) * (volumeHeight - 10); ctx.fillRect(x - body / 2, height - pad.b - vh, body, vh); ctx.globalAlpha = 1;
  });
  ctx.fillStyle = '#7f9098'; ctx.font = '9px ui-monospace'; ctx.textAlign = 'left';
  for (let i = 0; i <= 4; i += 1) { const value = max - range * (i / 4); ctx.fillText(fmtPrice(value), width - pad.r + 7, y(value) + 3); }
}

function renderLineChart(canvas, values, color) {
  const { ctx, width, height } = resizeCanvas(canvas); ctx.clearRect(0, 0, width, height); if (!values?.length) return;
  const max = Math.max(...values), min = Math.min(...values), range = max - min || 1; const pad = 12;
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath();
  values.forEach((value, index) => { const x = pad + index / Math.max(1, values.length - 1) * (width - pad * 2); const y = pad + (max - value) / range * (height - pad * 2); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  const zeroY = pad + (max - 0) / range * (height - pad * 2); if (zeroY >= pad && zeroY <= height - pad) { ctx.strokeStyle = '#45565f'; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(pad, zeroY); ctx.lineTo(width-pad, zeroY); ctx.stroke(); ctx.setLineDash([]); }
}

function renderMatrix() {
  $('#timeframeMatrix').innerHTML = TIMEFRAMES.map((tf) => {
    const d = state.matrix[tf]; if (!d) return `<div class="tf-cell" data-matrix-tf="${tf}"><header><span>${tf.toUpperCase()}</span><span>…</span></header><strong>SYNCING</strong><footer><span>—</span><span>—</span></footer></div>`;
    const trend = d.metrics.trend; const cls = trend > .35 ? 'state-up' : trend < -.35 ? 'state-down' : 'state-flat';
    const label = trend > .35 ? 'UP VECTOR' : trend < -.35 ? 'DOWN VECTOR' : 'NEUTRAL';
    return `<div class="tf-cell" data-matrix-tf="${tf}"><header><span>${tf.toUpperCase()}</span><span>R${d.metrics.volatilityPercentile >= 80 ? 3 : d.metrics.volatilityPercentile <= 20 ? 1 : 2}</span></header><strong class="${cls}">${label}</strong><footer><span>T ${signedScore(trend)}</span><span>V ${Math.round(d.metrics.volatilityPercentile)}</span></footer></div>`;
  }).join('');
  document.querySelectorAll('[data-matrix-tf]').forEach((cell) => cell.addEventListener('click', () => selectTimeframe(cell.dataset.matrixTf)));
}

function renderUniverse() {
  $('#universeGrid').innerHTML = ASSETS.map((asset) => `<div class="universe-card ${asset === state.asset ? 'active' : ''}" data-universe="${asset}"><header><span>${asset}</span><span>PERP</span></header><strong>${state.mids[asset] ? '$' + fmtPrice(state.mids[asset]) : '—'}</strong><small>HYPERLIQUID MID</small></div>`).join('');
  document.querySelectorAll('[data-universe]').forEach((card) => card.addEventListener('click', () => selectAsset(card.dataset.universe)));
}

async function loadMarket() {
  const generation = ++marketGeneration;
  const asset = state.asset;
  const timeframe = state.timeframe;
  setStatus(`SYNCING ${asset} ${timeframe.toUpperCase()}…`, 'pending');
  try {
    const data = await getJSON(`/api/market?coin=${asset}&interval=${timeframe}&flow=1`);
    if (generation !== marketGeneration || asset !== state.asset || timeframe !== state.timeframe || state.mode !== 'market') return;
    renderMarket(data);
    state.matrix[timeframe] = data;
    renderMatrix();
    setStatus(`${asset} ${timeframe.toUpperCase()} UPDATED`, 'live');
  } catch (error) {
    if (generation === marketGeneration && state.mode === 'market') setStatus(error.message, 'error');
  }
}

async function loadCollectorLive(asset = state.asset) {
  if (collectorLiveBusy) return;
  collectorLiveBusy = true;
  const generation = ++collectorGeneration;
  try { const summary = await getJSON(`/api/collector?asset=${asset}`); if (generation === collectorGeneration && asset === state.asset && state.mode === 'market') renderCollectorSummary(summary); }
  catch { if (generation === collectorGeneration && asset === state.asset && state.mode === 'market') renderCollectorSummary({ available: false, error: 'collector request failed' }); }
  finally { collectorLiveBusy = false; }
}

async function loadOverview() {
  try { const data = await getJSON('/api/overview'); state.mids = data.mids; renderUniverse(); }
  catch (error) { setStatus(error.message, 'error'); }
}

async function loadMatrix() {
  const generation = ++matrixGeneration;
  const asset = state.asset;
  $('#matrixStatus').textContent = 'SYNCING';
  const results = await Promise.allSettled(TIMEFRAMES.map(async (tf) => [tf, await getJSON(`/api/market?coin=${asset}&interval=${tf}`)]));
  if (generation !== matrixGeneration || asset !== state.asset) return;
  results.forEach((result) => { if (result.status === 'fulfilled') state.matrix[result.value[0]] = result.value[1]; });
  renderMatrix(); $('#matrixStatus').textContent = `${Object.keys(state.matrix).length}/5 ONLINE`;
}

function opportunityRow(item) {
  return `<tr>
    <td><strong>${esc(item.pair)}</strong></td>
    <td><span class="venue">${esc(item.longDex)}</span><small>${pct(item.longRate1h, 4)} / 1H</small></td>
    <td><span class="venue">${esc(item.shortDex)}</span><small>${pct(item.shortRate1h, 4)} / 1H</small></td>
    <td class="positive">${pct(item.grossRate1h, 4)}</td>
    <td><strong>${item.grossAnnualizedPct.toFixed(1)}%</strong></td>
    <td>${compactUSD(item.estimatedDailyPer1000)}</td>
    <td>${item.breakEvenHours.toFixed(1)}H</td>
    <td class="${item.priceDivergenceBps != null && item.priceDivergenceBps > 100 ? 'negative' : ''}">${item.priceDivergenceBps == null ? (item.priceRisk === 'ORACLE_PRICE_ONLY' ? 'ORACLE ONLY' : 'PRICE N/A') : `${item.priceDivergenceBps.toFixed(1)} BPS`}</td>
    <td><span class="grade ${esc(item.confidence)}">${esc(item.confidence).toUpperCase()}</span></td>
  </tr>`;
}

function populateArbVenues(markets) {
  const venues = [...new Set(markets.map((market) => market.dex))].sort();
  for (const [selector, placeholder] of [['#arbVenueA', 'ANY VENUE A'], ['#arbVenueB', 'ANY VENUE B']]) {
    const select = $(selector);
    const current = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>${venues.map((venue) => `<option value="${esc(venue)}">${esc(venue)}</option>`).join('')}`;
    if (venues.includes(current)) select.value = current;
  }
}

function renderOpportunityRoutes() {
  if (!state.funding) return;
  const pairQuery = $('#arbPairSearch').value.trim().toUpperCase();
  const venueA = $('#arbVenueA').value;
  const venueB = $('#arbVenueB').value;
  const routes = (state.funding.routes ?? state.funding.opportunities ?? []).filter((route) => {
    if (pairQuery && !route.pair.toUpperCase().includes(pairQuery)) return false;
    const venues = [route.longDex, route.shortDex];
    if (venueA && !venues.includes(venueA)) return false;
    if (venueB && !venues.includes(venueB)) return false;
    if (venueA && venueB && venueA === venueB) return false;
    return true;
  });
  $('#arbCount').textContent = `${routes.length} ROUTES`;
  $('#opportunityRows').innerHTML = routes.length
    ? routes.map(opportunityRow).join('')
    : '<tr><td colspan="9" class="empty-cell">NO ROUTE MATCHES THE SELECTED VENUES / PAIR</td></tr>';
}

function renderFunding(data) {
  state.funding = data;
  const opportunities = data.opportunities ?? [];
  const markets = data.markets ?? [];
  const online = Object.values(data.sources ?? {}).filter((source) => source.status === 'online').length;
  const best = opportunities[0];
  $('#fundingAsOf').textContent = new Date(data.asOf).toLocaleString(undefined, { hour12: false });
  $('#fundingQuality').textContent = `${online}/${Object.keys(data.sources ?? {}).length} VENUES`;
  $('#fundingQuality').className = `quality ${online >= 2 ? 'good' : 'bad'}`;
  $('#fundingSummary').innerHTML = [
    ['BEST GROSS APR', best ? `${best.grossAnnualizedPct.toFixed(1)}%` : '—', best?.pair ?? 'NO CROSS-VENUE MATCH'],
    ['BEST ROUTE', best ? `${esc(best.longDex)} → ${esc(best.shortDex)}` : '—', best ? `LONG ${best.pair} / SHORT ${best.pair}` : 'WAITING FOR DATA'],
    ['COST ASSUMPTION', `${Number(data.roundTripCostBps ?? 0).toFixed(0)} BPS`, 'COMBINED ROUND-TRIP'],
    ['LIVE MARKETS', String(markets.length), `${online} SOURCES ONLINE`],
  ].map(([label, value, detail]) => `<article><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`).join('');
  $('#sourceGrid').innerHTML = Object.entries(data.sources ?? {}).map(([name, source]) => `<div class="source-card ${source.status}"><span class="source-led"></span><div><strong>${esc(name)}</strong><small>${esc(source.status).toUpperCase()} · ${Number(source.markets ?? 0)} MARKETS</small></div></div>`).join('');
  populateArbVenues(markets);
  renderOpportunityRoutes();
  $('#fundingRows').innerHTML = markets.map((item) => {
    const annualized = item.fundingRate1h * 24 * 365 * 100;
    return `<tr><td><strong>${esc(item.ticker)}</strong></td><td>${esc(item.dex)}</td><td>${item.markPrice == null ? 'N/A' : `$${fmtPrice(item.markPrice)}`}</td><td class="${item.fundingRate1h >= 0 ? 'positive' : 'negative'}">${pct(item.fundingRate1h, 4)}</td><td>${annualized >= 0 ? '+' : ''}${annualized.toFixed(1)}%</td><td>${item.volume24h > 0 ? compactUSD(item.volume24h) : 'N/A'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-cell">NO FUNDING DATA AVAILABLE</td></tr>';
  filterFundingRows();
}

async function loadFunding() {
  const generation = ++fundingGeneration;
  setStatus('SYNCING FUNDING VENUES…', 'pending');
  try {
    const data = await getJSON('/api/funding');
    if (generation !== fundingGeneration || state.mode !== 'funding') return;
    renderFunding(data);
    setStatus(`FUNDING TRACKER · ${(data.routes ?? data.opportunities).length} ROUTES`, 'live');
  } catch (error) {
    if (generation === fundingGeneration && state.mode === 'funding') {
      $('#fundingQuality').textContent = 'DEGRADED';
      $('#fundingQuality').className = 'quality bad';
      setStatus(error.message, 'error');
    }
  }
}

function renderLiquidations(summary) {
  state.liquidations = summary;
  const analytics = summary?.analytics?.liquidations;
  const totals = analytics?.totals;
  const buckets = analytics?.buckets ?? [];
  const health = summary?.health?.data;
  $('#liquidationAsset').textContent = state.asset;
  $('#liquidationAsOf').textContent = new Date().toLocaleString(undefined, { hour12: false });
  $('#liquidationQuality').textContent = summary?.available ? 'LIVE' : 'OFFLINE';
  $('#liquidationQuality').className = `quality ${summary?.available ? 'good' : 'bad'}`;
  $('#liquidationCount').textContent = summary?.available ? `${buckets.length} WINDOWS` : 'NO DATA';
  $('#liquidationSummary').innerHTML = [
    ['TOTAL LIQUIDATED', totals?.total ?? '—', `SELECTED ASSET / ${state.liquidationWindow.toUpperCase()} WINDOW`],
    ['LONG POSITIONS', totals?.long ?? '—', 'POSITION SIDE'],
    ['SHORT POSITIONS', totals?.short ?? '—', 'POSITION SIDE'],
    ['EXPECTED PRESSURE', totals?.netExpectedPressure ?? '—', 'PRESENTATION METADATA'],
  ].map(([label, value, detail]) => `<article><span>${label}</span><strong>${esc(value)}</strong><small>${detail}</small></article>`).join('');
  renderLiquidationHeatmap(analytics?.heatmap);
  $('#liquidationRows').innerHTML = buckets.length
    ? [...buckets].reverse().map((bucket) => `<tr><td>${new Date(bucket.startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(bucket.endMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td class="negative">${esc(bucket.long)}</td><td class="positive">${esc(bucket.short)}</td><td>${esc(bucket.unknown)}</td><td><strong>${esc(bucket.total)}</strong></td><td>${esc(bucket.netExpectedPressure)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty-cell">NO LIQUIDATION DATA AVAILABLE</td></tr>';
  if (health?.status === 'ok') setStatus(`${state.asset} LIQUIDATIONS UPDATED`, 'live');
}

function renderLiquidationHeatmap(heatmap) {
  const buckets = heatmap?.buckets ?? [];
  const visible = (level) => state.liquidationSide === 'long' ? { ...level, total: level.long } : state.liquidationSide === 'short' ? { ...level, total: level.short } : level;
  const prices = [...new Set(buckets.flatMap((bucket) => (bucket.levels ?? []).filter((level) => Number(visible(level).total) > 0).map((level) => level.price)))].sort((a, b) => Number(b) - Number(a));
  const max = Math.max(...buckets.flatMap((bucket) => (bucket.levels ?? []).map((level) => Number(visible(level).total))), 1);
  if (!buckets.length || !prices.length) {
    $('#liquidationHeatmap').innerHTML = '<div class="empty-cell">NO ACTUAL LIQUIDATION LEVELS IN WINDOW</div>';
    return;
  }
  const header = `<div class="heatmap-corner">PRICE</div>${buckets.map((bucket) => `<div class="heatmap-time">${new Date(bucket.startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`).join('')}`;
  const rows = prices.map((price) => {
    const cells = buckets.map((bucket) => {
      const raw = (bucket.levels ?? []).find((item) => item.price === price);
      const level = raw ? visible(raw) : null;
      if (!level) return '<div class="heatmap-cell empty"></div>';
      const total = Number(level.total) || 0;
      const long = Number(level.long) || 0;
      const short = Number(level.short) || 0;
      const alpha = Math.min(.95, .16 + Math.sqrt(total / max) * .78);
      const color = long > short * 1.15 ? `rgba(255,95,104,${alpha})` : short > long * 1.15 ? `rgba(98,230,167,${alpha})` : `rgba(255,190,85,${alpha})`;
      return `<div class="heatmap-cell" style="background:${color}" title="${esc(price)} · total ${esc(level.total)} · long ${esc(level.long)} · short ${esc(level.short)}"><span>${compactNumber(total)}</span></div>`;
    }).join('');
    return `<div class="heatmap-price">${fmtPrice(price)}</div>${cells}`;
  }).join('');
  $('#liquidationHeatmap').innerHTML = `<div class="heatmap-grid" style="--heat-columns:${buckets.length}">${header}${rows}</div><div class="heatmap-legend"><span><i class="long"></i>LONG POSITIONS</span><span><i class="short"></i>SHORT POSITIONS</span><span><i class="mixed"></i>MIXED</span><small>${heatmap.method?.replaceAll('_', ' ') ?? 'ACTUAL EVENTS'}</small></div>`;
}

async function loadLiquidations() {
  const generation = ++fundingGeneration;
  setStatus(`SYNCING ${state.asset} LIQUIDATIONS…`, 'pending');
  try {
    const data = await getJSON(`/api/collector?asset=${state.asset}&window=${state.liquidationWindow}&scope=liquidations`);
    if (generation !== fundingGeneration || state.mode !== 'liquidation') return;
    renderLiquidations(data);
  } catch (error) {
    if (generation === fundingGeneration && state.mode === 'liquidation') {
      renderLiquidations({ available: false, error: error.message });
      setStatus(error.message, 'error');
    }
  }
}

function loadAll() { loadMarket(); loadOverview(); loadMatrix(); loadCollectorLive(); }

function runCommand(raw) {
  const [command, value] = raw.trim().split(/\s+/); const cmd = command?.toLowerCase();
  if (cmd === 'asset') selectAsset(String(value).toUpperCase());
  else if (cmd === 'timeframe') selectTimeframe(String(value).toLowerCase());
  else if (cmd === 'mode') selectMode(String(value).toLowerCase());
  else if (cmd === 'funding') selectMode('funding');
  else if (cmd === 'liquidation' || cmd === 'liquidations') selectMode('liquidation');
  else if (cmd === 'market') selectMode('market');
  else if (cmd === 'refresh') state.mode === 'funding' ? loadFunding() : state.mode === 'liquidation' ? loadLiquidations() : loadAll();
}

function filterFundingRows() {
  const query = $('#fundingFilter').value.trim().toUpperCase();
  document.querySelectorAll('#fundingRows tr').forEach((row) => {
    row.hidden = Boolean(query) && !row.textContent.toUpperCase().includes(query);
  });
}

function setupCommands() {
  const dialog = $('#commandDialog'), input = $('#commandInput');
  const open = () => { dialog.showModal(); setTimeout(() => input.focus(), 0); };
  $('#commandTrigger').addEventListener('click', open);
  document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); } if (event.key === '/' && !dialog.open) { event.preventDefault(); open(); } });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runCommand(input.value); input.value = ''; dialog.close(); } });
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => runCommand(button.dataset.command)));
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => selectMode(button.dataset.mode)));
  $('#workspaceSelect').addEventListener('change', (event) => selectWorkspace(event.target.value));
  $('#liquidationWindow').addEventListener('change', (event) => { state.liquidationWindow = event.target.value; if (state.mode === 'liquidation') loadLiquidations(); });
  document.querySelectorAll('[data-liq-side]').forEach((button) => button.addEventListener('click', () => { state.liquidationSide = button.dataset.liqSide; document.querySelectorAll('[data-liq-side]').forEach((item) => item.classList.toggle('active', item === button)); renderLiquidationHeatmap(state.liquidations?.analytics?.liquidations?.heatmap); }));
  $('#fundingFilter').addEventListener('input', filterFundingRows);
  $('#arbPairSearch').addEventListener('input', renderOpportunityRoutes);
  $('#arbVenueA').addEventListener('change', renderOpportunityRoutes);
  $('#arbVenueB').addEventListener('change', renderOpportunityRoutes);
  $('#arbReset').addEventListener('click', () => {
    $('#arbPairSearch').value = '';
    $('#arbVenueA').value = '';
    $('#arbVenueB').value = '';
    renderOpportunityRoutes();
  });
}

function tickClock() { $('#clock').textContent = `${new Date().toISOString().slice(11, 16)} UTC`; }
window.addEventListener('resize', () => { if (state.market) { renderPriceChart($('#priceChart'), state.market.series.candles); renderLineChart($('#deltaChart'), state.market.series.cumulativeDelta, state.market.metrics.bookImbalance >= 0 ? '#62e6a7' : '#ff5f68'); } });

renderTabs(); renderMatrix(); renderUniverse(); setupCollapsiblePanels(); setupCommands(); tickClock(); loadAll();
setInterval(tickClock, 30_000);
setInterval(() => { if (state.mode === 'market') loadMarket(); }, 15_000);
setInterval(() => { if (state.mode === 'market') loadOverview(); }, 15_000);
setInterval(() => { if (state.mode === 'market') loadMatrix(); }, 60_000);
setInterval(() => { if (state.mode === 'funding') loadFunding(); }, 30_000);
setInterval(() => { if (state.mode === 'liquidation') loadLiquidations(); }, 30_000);
setInterval(() => { if (state.mode === 'market') loadCollectorLive(); }, 15_000);
