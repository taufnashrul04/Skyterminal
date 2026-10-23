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
const state = { mode: 'market', workspace: 'core', asset: 'BTC', timeframe: '5m', liquidationWindow: '24h', liquidationView: 'projected', fundingHorizon: 4, liquidationSide: 'all', market: null, collector: null, funding: null, liquidations: null, liquidationMap: null, heatmapFull: null, liquidationLevels: null, mids: {}, matrix: {}, busy: false };
let marketGeneration = 0;
let matrixGeneration = 0;
let fundingGeneration = 0;
let collectorGeneration = 0;
let collectorLiveBusy = false;
let liquidationBusy = false;
let modeAbort = new AbortController();

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
  const response = await fetch(url, { cache: 'no-store', signal: modeAbort.signal, ...options });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { statusCode: response.status });
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
  const trigger = $('#workspaceTrigger');
  if (trigger) { trigger.firstChild.textContent = `${workspace.label} `; trigger.setAttribute('aria-expanded', 'false'); }
  document.querySelectorAll('[data-workspace]').forEach((button) => button.classList.toggle('active', button.dataset.workspace === id));
  $('#workspaceMenu')?.classList.remove('open');
  if (workspace.asset !== state.asset) selectAsset(workspace.asset);
  if (workspace.timeframe !== state.timeframe) selectTimeframe(workspace.timeframe);
  selectMode(workspace.mode);
  setStatus(`${workspace.label} LOADED`, 'live');
}

function selectMode(mode) {
  if (!['market', 'funding', 'liquidation'].includes(mode)) return;
  state.mode = mode;
  modeAbort.abort();
  modeAbort = new AbortController();
  marketGeneration += 1;
  matrixGeneration += 1;
  fundingGeneration += 1;
  $('#marketDashboard').hidden = mode !== 'market';
  $('#fundingDashboard').hidden = mode !== 'funding';
  $('#liquidationDashboard').hidden = mode !== 'liquidation';
  $('#assetTabs').hidden = mode === 'funding';
  $('#timeframeTabs').hidden = mode !== 'market';
  $('#workspaceControl').hidden = mode !== 'market';
  document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  if (mode === 'funding') loadFunding();
  else if (mode === 'liquidation') { if (!state.market || state.market.asset !== state.asset) loadMarket(); loadLiquidations(); }
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
  renderPriceChart($('#priceChart'), data.series.candles, state.mids[data.asset] ?? data.price);
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

function renderLiveProfile(profile) {
  const levels = profile?.levels ?? [];
  if (!levels.length) return;
  const maxVolume = Math.max(...levels.map((level) => Number(level.totalVolume) || 0), 1);
  $('#volumeProfile').innerHTML = [...levels].reverse().map((level) => {
    const isPoc = String(level.price) === String(profile.poc);
    return `<div class="profile-row ${isPoc ? 'poc' : ''}"><span>${fmtPrice(level.price)}</span><div class="profile-bar"><i style="width:${clamp((Number(level.totalVolume) || 0) / maxVolume * 100, 0, 100)}%"></i></div><b>${isPoc ? 'POC' : compactNumber(level.totalVolume)}</b></div>`;
  }).join('');
  $('#profileMethodNote').textContent = 'LIVE TRADE PROFILE · LAST 60 SECONDS · POC RECALCULATES EVERY SECOND';
}

function renderCollectorSummary(summary) {
  state.collector = summary;
  if (!state.market) return;
  const existing = [...document.querySelectorAll('#exoLiveMetrics .collector-card')];
  existing.forEach((node) => node.remove());
  const health = summary?.available ? summary.health?.data : null;
  renderLiveProfile(summary?.analytics?.profile);
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

function renderPriceChart(canvas, candles, livePrice = null) {
  const { ctx, width, height } = resizeCanvas(canvas); ctx.clearRect(0, 0, width, height);
  if (!candles?.length) return;
  const pad = { l: 14, r: 58, t: 22, b: 42 }; const volumeHeight = 62; const chartBottom = height - pad.b - volumeHeight;
  const highs = candles.map((c) => c.h), lows = candles.map((c) => c.l); const live = Number(livePrice); const max = Math.max(...highs, Number.isFinite(live) ? live : -Infinity), min = Math.min(...lows, Number.isFinite(live) ? live : Infinity); const range = max - min || 1;
  const step = (width - pad.l - pad.r) / candles.length; const body = Math.max(1, Math.min(7, step * .62)); const maxV = Math.max(...candles.map((c) => c.v), 1);
  const y = (price) => pad.t + ((max - price) / range) * (chartBottom - pad.t);
  candles.forEach((c, index) => {
    const x = pad.l + index * step + step / 2; const up = c.c >= c.o; const color = up ? '#62e6a7' : '#ff5f68';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.globalAlpha = .9; ctx.beginPath(); ctx.moveTo(x, y(c.h)); ctx.lineTo(x, y(c.l)); ctx.stroke();
    const top = Math.min(y(c.o), y(c.c)); const h = Math.max(1, Math.abs(y(c.o) - y(c.c))); ctx.fillRect(x - body / 2, top, body, h);
    ctx.globalAlpha = .28; const vh = (c.v / maxV) * (volumeHeight - 10); ctx.fillRect(x - body / 2, height - pad.b - vh, body, vh); ctx.globalAlpha = 1;
  });
  if (Number.isFinite(live)) {
    const liveY = y(live);
    ctx.save(); ctx.strokeStyle = '#b7ff4a'; ctx.fillStyle = '#b7ff4a'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.globalAlpha = .85;
    ctx.beginPath(); ctx.moveTo(pad.l, liveY); ctx.lineTo(width - pad.r, liveY); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(width - pad.r, liveY, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 9px ui-monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#07100a'; ctx.fillRect(width - pad.r + 7, liveY - 9, pad.r - 10, 18); ctx.fillStyle = '#b7ff4a'; ctx.fillText(fmtPrice(live), width - pad.r + 11, liveY + 3); ctx.restore();
  }
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
    if (error.name === 'AbortError') return;
    if (generation === marketGeneration && state.mode === 'market') setStatus(error.message, 'error');
  }
}

async function loadCollectorLive(asset = state.asset) {
  if (collectorLiveBusy) return;
  collectorLiveBusy = true;
  const generation = ++collectorGeneration;
  try { const summary = await getJSON(`/api/collector?asset=${asset}&window=1m&scope=live`); if (generation === collectorGeneration && asset === state.asset && state.mode === 'market') renderCollectorSummary(summary); }
  catch (error) { if (error.name === 'AbortError') return; if (generation === collectorGeneration && asset === state.asset && state.mode === 'market') renderCollectorSummary({ available: false, error: 'collector request failed' }); }
  finally { collectorLiveBusy = false; }
}

async function loadOverview() {
  try { const data = await getJSON('/api/overview'); state.mids = data.mids; renderUniverse(); if (state.market) renderPriceChart($('#priceChart'), state.market.series.candles, state.mids[state.asset] ?? state.market.price); }
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

function netEstimatePer1000(item, hours = state.fundingHorizon) {
  const cost = Number(state.funding?.roundTripCostBps ?? 0) / 10_000 * 1_000;
  return Number((Number(item.grossRate1h) * hours * 1_000 - cost).toFixed(2));
}

function opportunityRow(item) {
  const net = netEstimatePer1000(item);
  return `<tr>
    <td><strong>${esc(item.pair)}</strong></td>
    <td><span class="venue">${esc(item.longDex)}</span><small>${pct(item.longRate1h, 4)} / 1H</small></td>
    <td><span class="venue">${esc(item.shortDex)}</span><small>${pct(item.shortRate1h, 4)} / 1H</small></td>
    <td class="positive">${pct(item.grossRate1h, 4)}</td>
    <td><strong>${item.grossAnnualizedPct.toFixed(1)}%</strong></td>
    <td class="${net >= 0 ? 'positive' : 'negative'}">$${net.toFixed(2)}</td>
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
    : '<tr><td colspan="10" class="empty-cell">NO ROUTE MATCHES THE SELECTED VENUES / PAIR</td></tr>';
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
  const horizon = state.fundingHorizon;
  const bestNet = best ? netEstimatePer1000(best, horizon) : null;
  $('#fundingNetHeader').textContent = `NET $/1K @${horizon}H`;
  $('#fundingSummary').innerHTML = [
    ['BEST GROSS APR', best ? `${best.grossAnnualizedPct.toFixed(1)}%` : '—', best ? `NET @${horizon}H $${bestNet.toFixed(2)} / $1K` : 'NO CROSS-VENUE MATCH'],
    ['BEST ROUTE', best ? `${esc(best.longDex)} → ${esc(best.shortDex)}` : '—', best ? `LONG ${best.pair} / SHORT ${best.pair}` : 'WAITING FOR DATA'],
    ['COST ASSUMPTION', `${Number(data.roundTripCostBps ?? 0).toFixed(0)} BPS`, data.costModel ?? 'FEES + ESTIMATED SPREAD'],
    ['LIVE MARKETS', String(markets.length), `${online} SOURCES ONLINE`],
  ].map(([label, value, detail]) => `<article><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`).join('');
  const sourceCards = Object.entries(data.sources ?? {}).map(([name, source]) => `<div class="source-card ${source.status}"><span class="source-led"></span><div><strong>${esc(name)}</strong><small>${esc(source.status).toUpperCase()} · ${Number(source.markets ?? 0)} MARKETS</small></div></div>`).join('');
  const sourceSignature = Object.entries(data.sources ?? {}).map(([name, source]) => `${name}:${source.status}:${source.markets ?? 0}`).join('|');
  if ($('#sourceGrid').dataset.signature !== sourceSignature) {
    $('#sourceGrid').innerHTML = `<div class="source-marquee-track">${sourceCards}${sourceCards}</div>`;
    $('#sourceGrid').dataset.signature = sourceSignature;
  }
  populateArbVenues(markets);
  renderOpportunityRoutes();
  $('#fundingRows').innerHTML = markets.map((item) => {
    const unavailable = item.supportsFunding === false;
    const annualized = item.fundingRate1h * 24 * 365 * 100;
    return `<tr><td><strong>${esc(item.ticker)}</strong></td><td>${esc(item.dex)}</td><td>${item.markPrice == null ? 'N/A' : `$${fmtPrice(item.markPrice)}`}</td><td class="${unavailable ? '' : item.fundingRate1h >= 0 ? 'positive' : 'negative'}">${unavailable ? 'N/A' : pct(item.fundingRate1h, 4)}</td><td>${unavailable ? 'NO FUNDING' : `${annualized >= 0 ? '+' : ''}${annualized.toFixed(1)}%`}</td><td>${item.volume24h > 0 ? compactUSD(item.volume24h) : 'N/A'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-cell">NO FUNDING DATA AVAILABLE</td></tr>';
  filterFundingRows();
}

async function loadFunding() {
  const generation = ++fundingGeneration;
  setStatus('SYNCING FUNDING VENUES…', 'pending');
  if (!state.funding) {
    $('#opportunityRows').innerHTML = Array.from({ length: 5 }, () => '<tr class="skeleton-row"><td colspan="10"><div class="skeleton-line"></div></td></tr>').join('');
    $('#fundingRows').innerHTML = Array.from({ length: 8 }, () => '<tr class="skeleton-row"><td colspan="6"><div class="skeleton-line"></div></td></tr>').join('');
  }
  try {
    const data = await getJSON('/api/funding');
    if (generation !== fundingGeneration || state.mode !== 'funding') return;
    renderFunding(data);
    setStatus(`FUNDING TRACKER · ${(data.routes ?? data.opportunities).length} ROUTES`, 'live');
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation === fundingGeneration && state.mode === 'funding') {
      $('#fundingQuality').textContent = 'DEGRADED';
      $('#fundingQuality').className = 'quality bad';
      setStatus(error.message, 'error');
    }
  }
}

function renderLiquidations(summary, liquidationMap = null, fullHeatmap = null) {
  state.liquidations = summary;
  state.liquidationMap = liquidationMap;
  if (fullHeatmap !== null) state.heatmapFull = fullHeatmap;
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
  renderLiquidationView(analytics?.heatmap, liquidationMap);
  $('#liquidationRows').innerHTML = buckets.length
    ? [...buckets].reverse().map((bucket) => `<tr><td>${new Date(bucket.startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(bucket.endMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td class="negative">${esc(bucket.long)}</td><td class="positive">${esc(bucket.short)}</td><td>${esc(bucket.unknown)}</td><td><strong>${esc(bucket.total)}</strong></td><td>${esc(bucket.netExpectedPressure)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty-cell">NO LIQUIDATION DATA AVAILABLE</td></tr>';
  if (health?.status === 'ok') setStatus(`${state.asset} LIQUIDATIONS UPDATED`, 'live');
}

function renderLiquidationView(heatmap, model) {
  if (state.liquidationView === 'projected') return renderProjectedHeatmap();
  if (state.liquidationView === 'map') return renderProjectedMap();
  if (state.liquidationView === 'heatmap') return renderLiquidationHeatmap();
  if (state.liquidationView === 'history') return renderLiquidationHistory(heatmap);
  return renderLiquidationLadder(heatmap, model);
}

function renderLiquidationHistory(heatmap) {
  const buckets = heatmap?.buckets ?? []; const root = $('#liquidationHeatmap');
  if (!buckets.length) { root.innerHTML = '<div class="empty-cell">NO LIQUIDATION HISTORY</div>'; return; }
  root.innerHTML = '<canvas id="liquidationChart" aria-label="Liquidation history"></canvas><div class="heatmap-legend"><span><i class="liquidation-leverage"></i>LONG</span><span><i class="supercharts"></i>SHORT</span><small>ACTUAL EVENT HISTORY</small></div>';
  const canvas = $('#liquidationChart'); const { ctx, width, height } = resizeCanvas(canvas); const pad = { top: 28, right: 16, bottom: 34, left: 60 }; const plotW = width - pad.left - pad.right; const plotH = height - pad.top - pad.bottom;
  const rows = buckets.map((bucket) => ({ time: bucket.startMs, long: Number(bucket.long) || 0, short: Number(bucket.short) || 0 })); const max = Math.max(...rows.map((row) => Math.max(row.long, row.short)), 1); const x = (i) => pad.left + (i / Math.max(1, rows.length - 1)) * plotW; const y = (value) => pad.top + plotH - (value / max) * plotH;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = 'rgba(150,160,170,.15)'; ctx.font = '9px IBM Plex Mono, monospace'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i += 1) { const value = max * i / 4; const py = y(value); ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke(); ctx.fillStyle = '#77818b'; ctx.fillText(compactNumber(value), pad.left - 8, py + 3); }
  const step = Math.max(2, plotW / Math.max(1, rows.length)); rows.forEach((row, index) => { const px = x(index) - step / 2; if (state.liquidationSide !== 'short') { ctx.fillStyle = 'rgba(238,74,94,.82)'; ctx.fillRect(px, y(row.long), Math.max(1, step * .45), pad.top + plotH - y(row.long)); } if (state.liquidationSide !== 'long') { ctx.fillStyle = 'rgba(43,202,126,.82)'; ctx.fillRect(px + step * .5, y(row.short), Math.max(1, step * .45), pad.top + plotH - y(row.short)); } });
  ctx.textAlign = 'center'; ctx.fillStyle = '#77818b'; const labels = Math.min(7, rows.length); for (let i = 0; i < labels; i += 1) { const index = Math.round(i * (rows.length - 1) / Math.max(1, labels - 1)); ctx.fillText(new Date(rows[index].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), x(index), height - 12); }
}

function renderLiquidationLadder(heatmap, model = null) {
  const buckets = heatmap?.buckets ?? []; const modelLevels = model?.levels ?? []; const root = $('#liquidationHeatmap');
  const mark = Number(model?.mark ?? state.mids[state.asset] ?? state.market?.price); const bandPct = 25;
  if (!(mark > 0)) { root.innerHTML = '<div class="empty-cell">MARK PRICE UNAVAILABLE</div>'; return; }
  const bands = new Map();
  const add = (distance, side, notional, estimated) => {
    if (!Number.isFinite(distance) || Math.abs(distance) > bandPct || notional <= 0) return;
    const key = Math.max(-bandPct, Math.min(bandPct, Math.round(distance))); const row = bands.get(key) ?? { distance: key, estimatedLong: 0, estimatedShort: 0, actualLong: 0, actualShort: 0 };
    const target = estimated ? `estimated${side === 'long' ? 'Long' : 'Short'}` : `actual${side === 'long' ? 'Long' : 'Short'}`; row[target] += notional; bands.set(key, row);
  };
  for (const bucket of buckets) for (const raw of bucket.levels ?? []) {
    const price = Number(raw.price); if (!(price > 0)) continue; const distance = (price / mark - 1) * 100;
    if (state.liquidationSide !== 'short') add(distance, 'long', (Number(raw.long) || 0) * price, false);
    if (state.liquidationSide !== 'long') add(distance, 'short', (Number(raw.short) || 0) * price, false);
  }
  for (const level of modelLevels) if (state.liquidationSide === 'all' || state.liquidationSide === level.side) add(Number(level.distancePct), level.side, Number(level.notional), true);
  if (!bands.size) { root.innerHTML = '<div class="empty-cell">NO LIQUIDATION LEVELS WITHIN ±25%</div>'; return; }
  root.innerHTML = '<canvas id="liquidationChart" aria-label="Liquidation level ladder"></canvas><div class="heatmap-legend"><span><i class="liquidation-leverage"></i>ESTIMATED OI / LEVERAGE</span><span><i class="supercharts"></i>ACTUAL EXCHANGE EVENTS</span><small>LONG LIQUIDATIONS ← MARK → SHORT LIQUIDATIONS · ESTIMATE ≠ ORDER</small></div>';
  const canvas = $('#liquidationChart'); const { ctx, width, height } = resizeCanvas(canvas); const pad = { top: 48, right: 28, bottom: 42, left: 54 }; const plotW = width - pad.left - pad.right; const plotH = height - pad.top - pad.bottom; const center = pad.left + plotW / 2;
  const y = (distance) => pad.top + ((bandPct - distance) / (bandPct * 2)) * plotH; const maxValue = Math.max(...[...bands.values()].map((r) => Math.max(r.estimatedLong + r.actualLong, r.estimatedShort + r.actualShort)), 1); const maxBar = plotW / 2 - 18; const scale = (value) => Math.min(maxBar, Math.sqrt(value / maxValue) * maxBar);
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#0c1414'; ctx.fillRect(0, 0, width, height); ctx.font = '10px IBM Plex Mono, monospace';
  ctx.fillStyle = '#93a19b'; ctx.textAlign = 'left'; ctx.fillText(`${state.asset} · ESTIMATED LIQUIDATION LEVELS`, pad.left, 18); ctx.fillStyle = '#e4b83d'; ctx.textAlign = 'center'; ctx.fillText(`MARK  $${fmtPrice(mark)}`, center, 18);
  ctx.fillStyle = '#ef5c6d'; ctx.textAlign = 'left'; ctx.fillText('LONG', pad.left, 36); ctx.fillStyle = '#39d38d'; ctx.textAlign = 'right'; ctx.fillText('SHORT', pad.left + plotW, 36);
  ctx.textAlign = 'right';
  for (let distance = 25; distance >= -25; distance -= 5) { const py = y(distance); ctx.fillStyle = distance === 0 ? 'rgba(228,184,61,.22)' : 'rgba(146,163,157,.08)'; ctx.fillRect(pad.left, py - 10, plotW, 20); ctx.strokeStyle = distance === 0 ? 'rgba(228,184,61,.5)' : 'rgba(146,163,157,.14)'; ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke(); ctx.fillStyle = distance === 0 ? '#e4b83d' : '#879590'; ctx.fillText(`${distance > 0 ? '+' : ''}${distance}%`, pad.left - 9, py + 3); }
  ctx.strokeStyle = '#e4b83d'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(center, pad.top, center, pad.top + plotH); ctx.stroke(); ctx.setLineDash([]);
  for (const row of [...bands.values()].sort((a, b) => b.distance - a.distance)) { const py = y(row.distance); const longOuter = scale(row.estimatedLong + row.actualLong); const shortOuter = scale(row.estimatedShort + row.actualShort); const longActual = scale(row.actualLong); const shortActual = scale(row.actualShort); const h = 13;
    if (longOuter) { ctx.fillStyle = 'rgba(239,92,109,.2)'; ctx.fillRect(center - longOuter, py - h / 2, longOuter, h); } if (shortOuter) { ctx.fillStyle = 'rgba(57,211,141,.2)'; ctx.fillRect(center, py - h / 2, shortOuter, h); }
    if (longActual) { ctx.fillStyle = '#ef5c6d'; ctx.fillRect(center - longActual, py - 4, longActual, 8); } if (shortActual) { ctx.fillStyle = '#39d38d'; ctx.fillRect(center, py - 4, shortActual, 8); }
  }
  ctx.fillStyle = '#64726d'; ctx.textAlign = 'center'; ctx.fillText('LONG LIQUIDATION NOTIONAL', pad.left + plotW * .25, height - 16); ctx.fillText('SHORT LIQUIDATION NOTIONAL', pad.left + plotW * .75, height - 16);
}

function renderLiquidationMap(heatmap, model = null) {
  const buckets = heatmap?.buckets ?? [];
  const modelLevels = model?.levels ?? [];
  const root = $('#liquidationHeatmap');
  if (!buckets.length && !modelLevels.length) { root.innerHTML = '<div class="empty-cell">NO LIQUIDATION DATA AVAILABLE</div>'; return; }
  const mark = Number(model?.mark ?? state.mids[state.asset] ?? state.market?.price);
  if (!(mark > 0)) { root.innerHTML = '<div class="empty-cell">MARK PRICE UNAVAILABLE</div>'; return; }
  const bandPct = 25;
  const levels = new Map();
  for (const bucket of buckets) for (const raw of bucket.levels ?? []) {
    const price = Number(raw.price); if (!(price > 0)) continue;
    const distance = (price / mark - 1) * 100; if (Math.abs(distance) > bandPct) continue;
    const key = Math.round(distance * 10) / 10;
    const current = levels.get(key) ?? { distance: key, long: 0, short: 0 };
    current.long += Number(raw.long) || 0; current.short += Number(raw.short) || 0; levels.set(key, current);
  }
  const rows = [...levels.values()].map((row) => {
    const long = state.liquidationSide === 'short' ? 0 : row.long;
    const short = state.liquidationSide === 'long' ? 0 : row.short;
    return { ...row, longNotional: long * mark, shortNotional: short * mark, estimated: false };
  });
  const estimated = modelLevels.reduce((map, level) => {
    const key = Math.round(Number(level.distancePct) * 10) / 10;
    const row = map.get(key) ?? { distance: key, longNotional: 0, shortNotional: 0, estimated: true };
    if (state.liquidationSide !== 'short' && level.side === 'long') row.longNotional += Number(level.notional) || 0;
    if (state.liquidationSide !== 'long' && level.side === 'short') row.shortNotional += Number(level.notional) || 0;
    map.set(key, row); return map;
  }, new Map());
  const estimatedRows = [...estimated.values()];
  const displayRows = [...rows, ...estimatedRows];
  if (!displayRows.length) { root.innerHTML = '<div class="empty-cell">NO EVENTS OR ESTIMATED LEVELS WITHIN ±25% OF MARK</div>'; return; }
  root.innerHTML = '<canvas id="liquidationChart" aria-label="Exchange liquidation map"></canvas><div class="heatmap-legend"><span><i class="liquidation-leverage"></i>ESTIMATED LEVELS</span><span><i class="supercharts"></i>ACTUAL EVENTS</span><small>DEX + CEX · MARK ±25% · ESTIMATE ≠ EXECUTABLE ORDER</small></div>';
  const canvas = $('#liquidationChart'); const { ctx, width, height } = resizeCanvas(canvas);
  const pad = { top: 30, right: 16, bottom: 36, left: 54 }; const plotW = width - pad.left - pad.right; const plotH = height - pad.top - pad.bottom;
  const x = (distance) => pad.left + ((distance + bandPct) / (bandPct * 2)) * plotW;
  const maxValue = Math.max(displayRows.reduce((sum, row) => sum + row.longNotional, 0), displayRows.reduce((sum, row) => sum + row.shortNotional, 0), 1);
  const y = (value) => pad.top + plotH - (value / maxValue) * plotH;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, width, height);
  ctx.font = '9px IBM Plex Mono, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#9aa4ae'; ctx.fillText(`${rows.length} PRICE BINS WITHIN ±${bandPct}% OF MARK · ${state.asset}`, 10, 14);
  ctx.strokeStyle = 'rgba(150,160,170,.13)'; ctx.lineWidth = 1; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i += 1) { const value = maxValue * i / 4; const py = y(value); ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke(); ctx.fillStyle = '#747d86'; ctx.fillText(compactUSD(value), pad.left - 8, py + 3); }
  const zeroX = x(0); ctx.strokeStyle = '#d9a929'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(zeroX, pad.top, zeroX, pad.top + plotH); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#d9a929'; ctx.textAlign = 'center'; ctx.fillText(`MARK $${fmtPrice(mark)}`, zeroX, pad.top - 8);
  const binWidth = Math.max(2, plotW / Math.max(40, bandPct * 2 * 2));
  const sorted = [...displayRows].sort((a, b) => a.distance - b.distance);
  for (const row of sorted) {
    const px = x(row.distance); const longY = y(row.longNotional); const shortY = y(row.shortNotional);
    if (row.longNotional > 0) { ctx.fillStyle = row.estimated ? 'rgba(238,74,94,.22)' : 'rgba(238,74,94,.8)'; ctx.fillRect(px - binWidth / 2, longY, binWidth, pad.top + plotH - longY); }
    if (row.shortNotional > 0) { ctx.fillStyle = row.estimated ? 'rgba(43,202,126,.24)' : 'rgba(43,202,126,.82)'; ctx.fillRect(px - binWidth / 2, shortY, binWidth, pad.top + plotH - shortY); }
  }
  const drawCurve = (key, color, fill) => { const points = sorted.filter((r) => r.distance <= 0 && r[key] > 0); if (key === 'shortNotional') points.push(...sorted.filter((r) => r.distance >= 0 && r[key] > 0)); if (points.length < 2) return; points.sort((a, b) => a.distance - b.distance); let cumulative = 0; const path = points.map((r) => { cumulative += r[key]; return { x: x(r.distance), y: y(cumulative) }; }); ctx.beginPath(); path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.lineTo(path.at(-1).x, pad.top + plotH); ctx.lineTo(path[0].x, pad.top + plotH); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.beginPath(); path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); };
  drawCurve('longNotional', '#f25b6b', 'rgba(238,74,94,.2)'); drawCurve('shortNotional', '#2bca7e', 'rgba(43,202,126,.2)');
  ctx.textAlign = 'center'; ctx.fillStyle = '#858f98'; for (const pctLabel of [-25, -19, -13, -6, 0, 6, 13, 19, 25]) ctx.fillText(`${pctLabel > 0 ? '+' : ''}${pctLabel}%`, x(pctLabel), height - 13);
}

function renderLiquidationHeatmap() {
  const fullHeatmap = state.heatmapFull;
  const heatmap = fullHeatmap?.heatmap;
  const mark = Number(fullHeatmap?.mark ?? state.mids[state.asset] ?? state.market?.price);
  const root = $('#liquidationHeatmap');

  const sideFilter = state.liquidationSide;
  const rawBuckets = heatmap?.buckets ?? [];

  if (!rawBuckets.length) {
    root.innerHTML = '<div class="empty-cell">ACCUMULATING LIQUIDATION DATA — COLLECTOR BUILDS HISTORY IN REAL TIME</div>';
    return;
  }

  // Filter levels by side, merge small buckets to at most 96 columns
  const MAX_COLS = 96;
  const groupSize = Math.max(1, Math.ceil(rawBuckets.length / MAX_COLS));
  const buckets = [];
  for (let start = 0; start < rawBuckets.length; start += groupSize) {
    const group = rawBuckets.slice(start, start + groupSize);
    const byPrice = new Map();
    group.forEach((b) => (b.levels ?? []).forEach((lv) => {
      const key = String(lv.price);
      const cur = byPrice.get(key) ?? { price: lv.price, long: 0, short: 0, unknown: 0, total: 0 };
      const longVal  = sideFilter === 'short' ? 0 : (Number(lv.long)  || 0);
      const shortVal = sideFilter === 'long'  ? 0 : (Number(lv.short) || 0);
      cur.long  += longVal; cur.short += shortVal;
      cur.unknown += Number(lv.unknown) || 0;
      cur.total += sideFilter === 'all' ? (Number(lv.total) || 0) : longVal + shortVal;
      byPrice.set(key, cur);
    }));
    buckets.push({ startMs: group[0].startMs, endMs: group.at(-1).endMs, levels: [...byPrice.values()] });
  }

  const allPrices = buckets.flatMap((b) => b.levels.map((l) => Number(l.price))).filter(Number.isFinite);
  if (!allPrices.length) { root.innerHTML = '<div class="empty-cell">NO LIQUIDATION PRICE LEVELS IN SELECTED WINDOW</div>'; return; }

  root.innerHTML = '<canvas id="liquidationChart" aria-label="Liquidation heatmap"></canvas>';
  const canvas = $('#liquidationChart');
  const { ctx, width, height } = resizeCanvas(canvas);

  const pad = { top: 20, right: 78, bottom: 26, left: 4 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const startMs = buckets[0].startMs;
  const endMs   = buckets.at(-1).endMs;

  // Price range: prefer candle data for full coverage
  const rawCandles = (state.market?.series?.candles ?? [])
    .map((c) => ({ t: Number(c.t ?? c.time ?? c.startMs ?? 0), o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c) }))
    .filter((c) => Number.isFinite(c.c) && c.t >= startMs - 3_600_000 && c.t <= endMs + 3_600_000);

  let priceHigh, priceLow;
  if (rawCandles.length >= 2) {
    priceHigh = Math.max(...rawCandles.map((c) => c.h));
    priceLow  = Math.min(...rawCandles.map((c) => c.l));
    const rng = priceHigh - priceLow || priceHigh * 0.02;
    priceHigh += rng * 0.04; priceLow -= rng * 0.04;
  } else {
    const hi = Math.max(...allPrices), lo = Math.min(...allPrices);
    const rng = hi - lo || (mark > 0 ? mark * 0.1 : 1000);
    priceHigh = hi + rng * 0.08; priceLow = lo - rng * 0.08;
  }
  const priceRange = priceHigh - priceLow || 1;

  // Coordinate transforms
  const xOf = (ms)    => pad.left + (ms - startMs) / Math.max(1, endMs - startMs) * plotW;
  const yOf = (price) => pad.top  + (1 - (price - priceLow) / priceRange) * plotH;

  // Cell dimensions
  const priceBinUSD = heatmap?.priceBin ? Number(heatmap.priceBin) : (priceRange / 60);
  const cellH = Math.max(2, (priceBinUSD / priceRange) * plotH);

  // Max notional for color scaling (use notional = qty × price)
  const maxNotional = Math.max(...buckets.flatMap((b) => b.levels.map((l) => (Number(l.total) || 0) * Number(l.price))), 1);

  // ── Background ──
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#06090f';
  ctx.fillRect(0, 0, width, height);

  // ── Grid lines ──
  ctx.strokeStyle = 'rgba(80,100,120,.07)';
  ctx.lineWidth = 1;
  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.fillStyle = '#3a4854';
  ctx.textAlign = 'left';
  const NUM_GRID = 7;
  for (let i = 0; i <= NUM_GRID; i++) {
    const price = priceLow + priceRange * (i / NUM_GRID);
    const py = yOf(price);
    if (py < pad.top - 4 || py > pad.top + plotH + 4) continue;
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    ctx.fillText(`$${fmtPrice(price)}`, pad.left + plotW + 5, py + 3);
  }

  // ── Heatmap cells (thermal color: warm for longs, cool for shorts) ──
  for (let bi = 0; bi < buckets.length; bi++) {
    const bucket = buckets[bi];
    const x0 = xOf(bucket.startMs);
    const x1 = bi < buckets.length - 1 ? xOf(buckets[bi + 1].startMs) : pad.left + plotW;
    const bw = Math.max(1, x1 - x0 - 0.5);

    for (const lv of bucket.levels) {
      const price = Number(lv.price);
      if (!Number.isFinite(price) || price < priceLow || price > priceHigh) continue;
      const notional = (Number(lv.total) || 0) * price;
      if (notional <= 0) continue;

      const longQty  = Number(lv.long)  || 0;
      const shortQty = Number(lv.short) || 0;
      const intensity = Math.pow(notional / maxNotional, 0.32);
      const alpha = 0.16 + intensity * 0.84;
      const longFrac = longQty / Math.max(longQty + shortQty, 0.001);

      let r, g, b;
      if (longFrac > 0.65) {
        // Long-dominated: yellow → orange → red
        r = 255; g = Math.round(215 - 170 * intensity); b = Math.round(25 * (1 - intensity));
      } else if (longFrac < 0.35) {
        // Short-dominated: cyan → teal → blue
        r = Math.round(25 * (1 - intensity)); g = Math.round(185 + 70 * intensity); b = 255;
      } else {
        // Mixed / unknown: golden-yellow → white
        r = 255; g = Math.round(200 + 55 * intensity); b = Math.round(80 * (1 - intensity));
      }

      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      if (intensity > 0.5) { ctx.shadowColor = `rgba(${r},${g},${b},${intensity * 0.45})`; ctx.shadowBlur = 5 + intensity * 9; }
      ctx.fillRect(x0, yOf(price) - cellH / 2, bw, Math.max(2, cellH));
      ctx.shadowBlur = 0;
    }
  }

  // ── Candlesticks ──
  if (rawCandles.length > 1) {
    const sorted = [...rawCandles].sort((a, b) => a.t - b.t);
    const avgInterval = (sorted.at(-1).t - sorted[0].t) / Math.max(1, sorted.length - 1);
    const cw = Math.max(2, Math.min(10, (avgInterval / Math.max(1, endMs - startMs)) * plotW * 0.65));

    for (const c of sorted) {
      if (c.c < priceLow * 0.99 || c.c > priceHigh * 1.01) continue;
      const cx = xOf(c.t);
      if (cx < pad.left - cw * 2 || cx > pad.left + plotW + cw * 2) continue;
      const isUp = c.c >= c.o;
      const candleColor = isUp ? 'rgba(56,211,141,.78)' : 'rgba(238,74,94,.78)';
      ctx.strokeStyle = candleColor; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, clamp(yOf(c.h), pad.top, pad.top + plotH));
      ctx.lineTo(cx, clamp(yOf(c.l), pad.top, pad.top + plotH));
      ctx.stroke();
      const bodyTop = clamp(yOf(Math.max(c.o, c.c)), pad.top, pad.top + plotH);
      const bodyBot = clamp(yOf(Math.min(c.o, c.c)), pad.top, pad.top + plotH);
      ctx.fillStyle = candleColor;
      ctx.fillRect(cx - cw / 2, bodyTop, cw, Math.max(1, bodyBot - bodyTop));
    }
  }

  // ── Mark price line ──
  if (Number.isFinite(mark) && mark >= priceLow && mark <= priceHigh) {
    const py = yOf(mark);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    ctx.restore();
    const labelText = `$${fmtPrice(mark)}`;
    ctx.font = 'bold 10px IBM Plex Mono, monospace';
    const labelW = ctx.measureText(labelText).width + 10;
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(pad.left + plotW + 2, py - 8, labelW, 16);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(labelText, pad.left + plotW + 7, py + 3);
  }

  // ── Time labels ──
  ctx.textAlign = 'center';
  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.fillStyle = '#3a4854';
  const numLabels = Math.min(8, buckets.length);
  for (let i = 0; i < numLabels; i++) {
    const idx = Math.round(i * (buckets.length - 1) / Math.max(1, numLabels - 1));
    ctx.fillText(
      new Date(buckets[idx].startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      xOf(buckets[idx].startMs), height - 9
    );
  }
}

// Coinglass-style ramp: a deep purple floor rising through teal and green to bright
// yellow where projected notional stacks up.
const HEAT_STOPS = [
  [0.00, [52, 10, 72]], [0.18, [74, 42, 138]], [0.38, [26, 122, 148]],
  [0.58, [38, 170, 126]], [0.78, [154, 216, 58]], [1.00, [248, 248, 70]],
];

function heatColour(t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i - 1], [p2, c2] = HEAT_STOPS[i];
    if (x <= p2) {
      const k = (x - p1) / (p2 - p1 || 1);
      return [0, 1, 2].map((j) => Math.round(c1[j] + (c2[j] - c1[j]) * k));
    }
  }
  return HEAT_STOPS.at(-1)[1];
}

function projectedCanvas(root, label) {
  root.innerHTML = '<canvas id="liquidationChart" aria-label="' + label + '"></canvas>';
  return resizeCanvas($('#liquidationChart'));
}

function renderProjectedHeatmap() {
  const root = $('#liquidationHeatmap');
  const model = state.liquidationLevels?.levels;
  const buckets = model?.buckets ?? [];
  const mark = Number(state.liquidationLevels?.mark ?? state.mids[state.asset] ?? 0);

  if (!buckets.length) {
    root.innerHTML = '<div class="empty-cell">BUILDING LIQUIDATION MODEL — NEEDS OPEN-INTEREST HISTORY</div>';
    return;
  }

  const { ctx, width, height } = projectedCanvas(root, 'Projected liquidation heatmap');
  const pad = { top: 16, right: 74, bottom: 26, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const startMs = buckets[0].startMs, endMs = buckets.at(-1).endMs;
  const prices = buckets.flatMap((b) => b.levels.map((l) => l.price)).filter(Number.isFinite);
  if (!prices.length) { root.innerHTML = '<div class="empty-cell">NO PROJECTED LEVELS IN WINDOW</div>'; return; }

  const candles = (state.market?.series?.candles ?? [])
    .map((c) => ({ t: Number(c.t ?? c.time ?? c.startMs ?? 0), o: +c.o, h: +c.h, l: +c.l, c: +c.c }))
    .filter((c) => Number.isFinite(c.c) && c.t >= startMs && c.t <= endMs);

  // Frame on the traded range so the candles stay readable. A fixed +/-10% window (where
  // 10x leverage projects) flattens price into a straight line on a quiet day, which
  // hides the one thing the chart is for: watching price approach a level. Far-out
  // levels clip instead.
  let span;
  if (candles.length > 1 && mark > 0) {
    const ch = Math.max(...candles.map((c) => c.h)), cl = Math.min(...candles.map((c) => c.l));
    const half = Math.max(ch - mark, mark - cl, (ch - cl) / 2, 0);
    span = clamp(half * 3, mark * 0.015, mark * 0.12);
  } else {
    span = mark > 0 ? mark * 0.05 : (Math.max(...prices) - Math.min(...prices)) / 2 || 1;
  }
  const hi = mark > 0 ? mark + span : Math.max(...prices);
  const lo = mark > 0 ? mark - span : Math.min(...prices);
  const range = hi - lo || 1;

  const xOf = (ms) => pad.left + (ms - startMs) / Math.max(1, endMs - startMs) * plotW;
  const yOf = (p) => pad.top + (1 - (p - lo) / range) * plotH;

  const visible = (l) => state.liquidationSide === 'long' ? l.long : state.liquidationSide === 'short' ? l.short : l.total;
  const peak = Math.max(...buckets.flatMap((b) => b.levels.map(visible)), 1);
  const bin = Number(model.priceBin) || range / 80;
  const cellH = Math.max(1.5, (bin / range) * plotH);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#120318';
  ctx.fillRect(0, 0, width, height);
  const base = heatColour(0);
  ctx.fillStyle = 'rgb(' + base[0] + ',' + base[1] + ',' + base[2] + ')';
  ctx.fillRect(pad.left, pad.top, plotW, plotH);

  // Bands: a level repeated across consecutive buckets paints a continuous horizontal run.
  for (let i = 0; i < buckets.length; i++) {
    const x0 = xOf(buckets[i].startMs);
    const x1 = i < buckets.length - 1 ? xOf(buckets[i + 1].startMs) : pad.left + plotW;
    const w = Math.max(1, x1 - x0 + 0.5);
    for (const l of buckets[i].levels) {
      const v = visible(l);
      if (v <= 0 || l.price < lo || l.price > hi) continue;
      const c = heatColour(Math.pow(v / peak, 0.45));
      ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx.fillRect(x0, yOf(l.price) - cellH / 2, w, cellH);
    }
  }

  // Candles over the model.
  if (candles.length > 1) {
    const step = (candles.at(-1).t - candles[0].t) / Math.max(1, candles.length - 1);
    const cw = Math.max(1.5, Math.min(7, (step / Math.max(1, endMs - startMs)) * plotW * 0.6));
    for (const c of candles) {
      const cx = xOf(c.t);
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? 'rgba(235,255,245,.85)' : 'rgba(255,170,190,.85)';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, clamp(yOf(c.h), pad.top, pad.top + plotH));
      ctx.lineTo(cx, clamp(yOf(c.l), pad.top, pad.top + plotH));
      ctx.stroke();
      const top = clamp(yOf(Math.max(c.o, c.c)), pad.top, pad.top + plotH);
      const bot = clamp(yOf(Math.min(c.o, c.c)), pad.top, pad.top + plotH);
      ctx.fillRect(cx - cw / 2, top, cw, Math.max(1, bot - top));
    }
  }

  // Colour scale, so the brightness means something.
  const barX = 12, barY = pad.top + 6, barW = 10, barH = Math.max(40, plotH - 40);
  for (let i = 0; i <= barH; i++) {
    const c = heatColour(1 - i / barH);
    ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    ctx.fillRect(barX, barY + i, barW, 1);
  }
  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.fillStyle = '#c9b8d6';
  ctx.textAlign = 'left';
  ctx.fillText(compactUSD(peak), barX - 4, barY - 4);
  ctx.fillText('0', barX - 4, barY + barH + 10);

  // Price axis.
  ctx.fillStyle = '#b9a8c6';
  for (let i = 0; i <= 6; i++) {
    const p = lo + range * (i / 6);
    const py = yOf(p);
    ctx.strokeStyle = 'rgba(220,200,240,.07)';
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    ctx.fillText('$' + fmtPrice(p), pad.left + plotW + 5, py + 3);
  }

  if (mark > 0 && mark >= lo && mark <= hi) {
    const py = yOf(mark);
    ctx.save();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    ctx.restore();
    ctx.font = 'bold 10px IBM Plex Mono, monospace';
    const t = '$' + fmtPrice(mark);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(pad.left + plotW + 2, py - 8, ctx.measureText(t).width + 10, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(t, pad.left + plotW + 7, py + 3);
  }

  // Time axis.
  ctx.textAlign = 'center';
  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.fillStyle = '#8f7fa0';
  const labels = Math.min(7, buckets.length);
  for (let i = 0; i < labels; i++) {
    const idx = Math.round(i * (buckets.length - 1) / Math.max(1, labels - 1));
    ctx.fillText(new Date(buckets[idx].startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), xOf(buckets[idx].startMs), height - 9);
  }

  // Say plainly how much is real OI and how much is the volume stand-in.
  const oi = buckets.filter((b) => b.source === 'oi').length;
  ctx.textAlign = 'left';
  ctx.fillStyle = oi === buckets.length ? '#7fe3a8' : '#d8b24a';
  ctx.fillText('MODELLED · ' + oi + '/' + buckets.length + ' buckets from open interest, rest volume proxy', pad.left + 2, 11);
}

function renderProjectedMap() {
  const root = $('#liquidationHeatmap');
  const map = state.liquidationLevels?.map;
  const mark = Number(state.liquidationLevels?.mark ?? state.mids[state.asset] ?? 0);
  const all = map?.levels ?? [];
  const rows = all.filter((l) => {
    if (!(l.price > 0)) return false;
    if (state.liquidationSide === 'long') return l.long > 0;
    if (state.liquidationSide === 'short') return l.short > 0;
    return l.total > 0;
  });

  if (!rows.length || !(mark > 0)) {
    root.innerHTML = '<div class="empty-cell">BUILDING LIQUIDATION MODEL — NEEDS OPEN-INTEREST HISTORY</div>';
    return;
  }

  const { ctx, width, height } = projectedCanvas(root, 'Projected liquidation map');
  const pad = { top: 34, right: 18, bottom: 34, left: 62 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const lo = Math.min(...rows.map((r) => r.price), mark);
  const hi = Math.max(...rows.map((r) => r.price), mark);
  const range = hi - lo || 1;
  const peak = Math.max(...rows.map((r) => Math.max(r.long, r.short)), 1);

  const xOf = (p) => pad.left + ((p - lo) / range) * plotW;
  const hOf = (v) => (v / peak) * plotH;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0a0710';
  ctx.fillRect(0, 0, width, height);

  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.fillStyle = '#7d708c';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = peak * (i / 4);
    const py = pad.top + plotH - hOf(v);
    ctx.strokeStyle = 'rgba(200,180,230,.08)';
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    ctx.fillText(compactUSD(v), pad.left - 7, py + 3);
  }

  const barW = Math.max(1.5, plotW / Math.max(rows.length, 40) * 0.8);
  for (const r of rows) {
    const x = xOf(r.price);
    // Longs liquidate below the mark, shorts above; colour follows that split.
    if (state.liquidationSide !== 'short' && r.long > 0) {
      ctx.fillStyle = 'rgba(255,96,112,.85)';
      ctx.fillRect(x - barW / 2, pad.top + plotH - hOf(r.long), barW, hOf(r.long));
    }
    if (state.liquidationSide !== 'long' && r.short > 0) {
      ctx.fillStyle = 'rgba(64,220,190,.85)';
      ctx.fillRect(x - barW / 2, pad.top + plotH - hOf(r.short), barW, hOf(r.short));
    }
  }

  const mx = xOf(mark);
  ctx.save();
  ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(mx, pad.top); ctx.lineTo(mx, pad.top + plotH); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ffd34d'; ctx.textAlign = 'center'; ctx.font = 'bold 10px IBM Plex Mono, monospace';
  ctx.fillText('MARK $' + fmtPrice(mark), mx, pad.top - 8);

  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.fillStyle = '#ff6070'; ctx.textAlign = 'left';
  ctx.fillText('LONG LIQUIDATIONS', pad.left, 16);
  ctx.fillStyle = '#40dcbe'; ctx.textAlign = 'right';
  ctx.fillText('SHORT LIQUIDATIONS', pad.left + plotW, 16);

  ctx.fillStyle = '#7d708c'; ctx.textAlign = 'center';
  for (let i = 0; i <= 6; i++) {
    const p = lo + range * (i / 6);
    ctx.fillText('$' + fmtPrice(p), xOf(p), height - 11);
  }
}

async function loadLiquidations() {
  if (liquidationBusy) return;
  liquidationBusy = true;
  const generation = ++fundingGeneration;
  setStatus(`SYNCING ${state.asset} LIQUIDATIONS…`, 'pending');
  if (!state.liquidations) {
    $('#liquidationRows').innerHTML = Array.from({ length: 4 }, () => '<tr class="skeleton-row"><td colspan="6"><div class="skeleton-line"></div></td></tr>').join('');
  }
  try {
    const [data, liquidationMap, fullHeatmap, levels] = await Promise.all([
      getJSON(`/api/collector?asset=${state.asset}`),
      getJSON(`/api/liquidation-map?asset=${state.asset}`),
      getJSON(`/api/liquidation-heatmap?asset=${state.asset}&window=${state.liquidationWindow}`).catch(() => null),
      getJSON(`/api/liquidation-levels?asset=${state.asset}&window=${state.liquidationWindow}`).catch(() => null),
    ]);
    if (levels) state.liquidationLevels = levels;
    if (generation !== fundingGeneration || state.mode !== 'liquidation') return;
    renderLiquidations(data, liquidationMap, fullHeatmap);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation === fundingGeneration && state.mode === 'liquidation') {
      renderLiquidations({ available: false, error: error.message });
      const msg = error.statusCode === 404 ? 'LIQUIDATION MAP UNAVAILABLE' : error.message;
      setStatus(msg, 'error');
    }
  } finally { liquidationBusy = false; }
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
  $('#workspaceTrigger').addEventListener('click', (event) => { event.stopPropagation(); const menu = $('#workspaceMenu'); const open = menu.classList.toggle('open'); $('#workspaceTrigger').setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('[data-workspace]').forEach((button) => button.addEventListener('click', () => selectWorkspace(button.dataset.workspace)));
  document.addEventListener('click', () => { $('#workspaceMenu').classList.remove('open'); $('#workspaceTrigger').setAttribute('aria-expanded', 'false'); });
  $('#liquidationView').addEventListener('change', (event) => { state.liquidationView = event.target.value; renderLiquidationView(state.liquidations?.analytics?.liquidations?.heatmap, state.liquidationMap); });
  $('#liquidationWindow').addEventListener('change', (event) => { state.liquidationWindow = event.target.value; if (state.mode === 'liquidation') loadLiquidations(); });
  document.querySelectorAll('[data-liq-side]').forEach((button) => button.addEventListener('click', () => { state.liquidationSide = button.dataset.liqSide; document.querySelectorAll('[data-liq-side]').forEach((item) => item.classList.toggle('active', item === button)); renderLiquidationView(state.liquidations?.analytics?.liquidations?.heatmap, state.liquidationMap); }));
  $('#fundingFilter').addEventListener('input', filterFundingRows);
  $('#fundingHorizon').addEventListener('change', (event) => { state.fundingHorizon = Number(event.target.value); if (state.funding) { const best = state.funding.opportunities?.[0] ?? state.funding.routes?.[0]; const horizon = state.fundingHorizon; $('#fundingNetHeader').textContent = `NET $/1K @${horizon}H`; $('#fundingSummary').querySelector('article small').textContent = best ? `NET @${horizon}H $${netEstimatePer1000(best, horizon).toFixed(2)} / $1K` : 'NO CROSS-VENUE MATCH'; renderOpportunityRoutes(); } });
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
window.addEventListener('resize', () => { if (state.market) { renderPriceChart($('#priceChart'), state.market.series.candles, state.mids[state.asset] ?? state.market.price); renderLineChart($('#deltaChart'), state.market.series.cumulativeDelta, state.market.metrics.bookImbalance >= 0 ? '#62e6a7' : '#ff5f68'); } });

renderTabs(); renderMatrix(); renderUniverse(); setupCollapsiblePanels(); setupCommands(); tickClock(); loadAll();

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const kbdEl = $('#commandTrigger').querySelector('kbd');
if (kbdEl) kbdEl.textContent = isMac ? '⌘K' : 'Ctrl+K';

setInterval(tickClock, 30_000);
setInterval(() => { if (state.mode === 'market') loadMarket(); }, 15_000);
setInterval(() => { if (state.mode !== 'funding') loadOverview(); }, 5_000);
setInterval(() => { if (state.mode === 'market') loadMatrix(); }, 60_000);
setInterval(() => { if (state.mode === 'funding') loadFunding(); }, 5_000);
setInterval(() => { if (state.mode === 'liquidation') loadLiquidations(); }, 5_000);
setInterval(() => { if (state.mode === 'market') loadCollectorLive(); }, 3_000);
