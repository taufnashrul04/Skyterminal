const ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];
const state = { asset: 'BTC', timeframe: '5m', market: null, mids: {}, matrix: {}, busy: false };

const $ = (selector) => document.querySelector(selector);
const fmtPrice = (value) => Number(value).toLocaleString('en-US', { minimumFractionDigits: Number(value) < 100 ? 2 : 1, maximumFractionDigits: Number(value) < 10 ? 4 : 2 });
const pct = (value, digits = 2) => `${value >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(digits)}%`;
const number = (value, digits = 2) => Number(value).toFixed(digits);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function setStatus(message, kind = 'live') {
  $('#statusMessage').textContent = message;
  $('#connectionLabel').textContent = kind === 'error' ? 'DEGRADED' : kind === 'pending' ? 'SYNCING' : 'LIVE';
  $('#liveDot').className = `live-dot ${kind}`;
}

async function getJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
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
  state.asset = asset; state.matrix = {}; renderTabs(); loadAll();
}
function selectTimeframe(timeframe) {
  if (!TIMEFRAMES.includes(timeframe)) return;
  state.timeframe = timeframe; renderTabs(); loadMarket();
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
  if (state.busy) return; state.busy = true; setStatus(`SYNCING ${state.asset} ${state.timeframe.toUpperCase()}…`, 'pending');
  try { const data = await getJSON(`/api/market?coin=${state.asset}&interval=${state.timeframe}`); renderMarket(data); state.matrix[state.timeframe] = data; renderMatrix(); setStatus(`${state.asset} ${state.timeframe.toUpperCase()} UPDATED`, 'live'); }
  catch (error) { setStatus(error.message, 'error'); }
  finally { state.busy = false; }
}

async function loadOverview() {
  try { const data = await getJSON('/api/overview'); state.mids = data.mids; renderUniverse(); }
  catch (error) { setStatus(error.message, 'error'); }
}

async function loadMatrix() {
  $('#matrixStatus').textContent = 'SYNCING';
  const results = await Promise.allSettled(TIMEFRAMES.map(async (tf) => [tf, await getJSON(`/api/market?coin=${state.asset}&interval=${tf}`)]));
  results.forEach((result) => { if (result.status === 'fulfilled') state.matrix[result.value[0]] = result.value[1]; });
  renderMatrix(); $('#matrixStatus').textContent = `${Object.keys(state.matrix).length}/5 ONLINE`;
}

function loadAll() { loadMarket(); loadOverview(); loadMatrix(); }

function runCommand(raw) {
  const [command, value] = raw.trim().split(/\s+/); const cmd = command?.toLowerCase();
  if (cmd === 'asset') selectAsset(String(value).toUpperCase());
  else if (cmd === 'timeframe') selectTimeframe(String(value).toLowerCase());
  else if (cmd === 'refresh') loadAll();
}

function setupCommands() {
  const dialog = $('#commandDialog'), input = $('#commandInput');
  const open = () => { dialog.showModal(); setTimeout(() => input.focus(), 0); };
  $('#commandTrigger').addEventListener('click', open);
  document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); } if (event.key === '/' && !dialog.open) { event.preventDefault(); open(); } });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runCommand(input.value); input.value = ''; dialog.close(); } });
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => runCommand(button.dataset.command)));
}

function tickClock() { $('#clock').textContent = `${new Date().toISOString().slice(11, 19)} UTC`; }
window.addEventListener('resize', () => { if (state.market) { renderPriceChart($('#priceChart'), state.market.series.candles); renderLineChart($('#deltaChart'), state.market.series.cumulativeDelta, state.market.metrics.bookImbalance >= 0 ? '#62e6a7' : '#ff5f68'); } });

renderTabs(); renderMatrix(); renderUniverse(); setupCommands(); tickClock(); loadAll();
setInterval(tickClock, 1_000); setInterval(loadMarket, 5_000); setInterval(loadOverview, 5_000); setInterval(loadMatrix, 60_000);
