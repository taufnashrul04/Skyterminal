# Skyterminal

Original web-based market intelligence terminal. **Market Intel** intentionally starts with **BTC, ETH, SOL, and HYPE**, while **Funding Arbitrage** scans every market returned by the connected venues.

## What is live

- Hyperliquid public market data adapter
- Multi-timeframe views: `5m`, `15m`, `1h`, `4h`, `1d`
- Candlestick and volume rendering
- Volatility-scaled fast/slow trend
- Realized-volatility percentile regime
- Historical 95% VaR and Expected Shortfall
- Drawdown, spread, L2 book imbalance and depth
- Candle-direction cumulative-volume proxy (explicitly labelled as a proxy)
- Keyboard command bar (`Ctrl/Cmd+K` or `/`)
- Responsive desktop/mobile monitor layout with bold color-coded section titles and per-panel minimize/restore controls persisted in the browser
- Exocharts-inspired live analytics from free public data: candle-derived volume profile (POC/VAH/VAL), window VWAP/high/low/range, recent aggressor-trade delta, trade imbalance, and an explicitly labelled absorption proxy
- Funding-arbitrage tracker across the full connected market universe, with pair search, two-venue route selectors, hourly-normalized rates, long/short venue routing, gross annualized spread, price-gap checks, and cost-aware break-even
- Live funding adapters for Hyperliquid, Variational, RISEx, Nado, TxFlow, Arcus, PopDEX, and Lighter
- Lighter uses its public `funding-rates` and `orderBookDetails` endpoints; the published 8-hour-equivalent rate is converted to the hourly settlement rate
- TxFlow, Arcus, and PopDEX rates come from ProFunding's open market-data endpoint (no API key); price/basis is explicitly shown as unavailable rather than fabricated
- Variational's API field is treated as an annualized decimal rate and converted to an hourly decimal before cross-venue comparison
- Partial-source resilience: one unavailable venue does not take down the tracker

## Run

```bash
git clone https://github.com/taufnashrul04/Skyterminal.git
cd Skyterminal
npm start
```

Open `http://127.0.0.1:4173`.

Optional configuration:

```bash
HOST=127.0.0.1 PORT=4173 npm start
# Behind a trusted reverse proxy only:
TRUST_PROXY=1 HOST=127.0.0.1 PORT=4173 npm start
```

## Deploy to Vercel

The repository includes Vercel Functions under `api/` and static rewrites in `vercel.json`.

Before publishing, configure these Vercel environment variables:

- `COLLECTOR_URL` — the collector's public HTTPS base URL. Do not use `127.0.0.1`; that would point to the Vercel runtime, not the AWS VPS.
- `COLLECTOR_TIMEOUT_MS` — optional collector request timeout; defaults to `12000` ms because the seven analytics queries run concurrently against SQLite.

The collector must remain behind HTTPS, authentication, and request limits before exposing it outside the VPS. The Vercel `/api/collector` function is the browser-facing proxy; the browser never calls the collector directly.

```bash
npx vercel
npx vercel --prod
```

## Test

```bash
npm test
node --check server.js
node --check public/app.js
```

## Structure

- `public/` — original Skyterminal web UI
- `lib/indicators.js` — book-derived deterministic indicator engine
- `lib/hyperliquid.js` — first public market-data adapter
- `lib/funding.js` — cross-venue funding adapters and arbitrage engine
- `server.js` — static server and API gateway
- `test/` — Node test suite
- `research/` — indicator specifications derived from the PDF corpus
- `imports/exocharts/` — decoded reference configurations and manifests

- Collector CVD is an aggregate of trade streams across Binance, Bybit, OKX, and Hyperliquid, combining spot and perpetual markets; it is not CEX-only and it is separate from liquidation events.
- Liquidation analytics currently come from Binance USD-M `forceOrder`, Bybit Linear `allLiquidation`, and OKX Swap `liquidation-orders`; Hyperliquid liquidation is not included.
- The dashboard labels this as `CVD — AGGREGATE SPOT + PERP` to avoid implying a single-venue or CEX-only calculation.
- The Exo live panel separately uses Hyperliquid's public recent aggressor trades for exact delta over the returned print window; it is not a persistent full-session CVD feed.
- Volume profile, POC, VAH, VAL, VWAP and absorption checks are candle-derived approximations and are labelled as proxies rather than native Exocharts footprints.
- Regime metrics are descriptive and should not be interpreted as guaranteed trade signals.
- Skyterminal currently monitors data only; order execution is disabled.
- Funding APR is a snapshot extrapolation, not guaranteed yield. Rates can flip, and basis, fees, slippage, liquidity, collateral, and venue risk can dominate the spread.
- The default break-even model assumes `12 bps` combined round-trip cost and should be adjusted before real execution.
