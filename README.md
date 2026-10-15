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
- Responsive desktop/mobile monitor layout
- Funding-arbitrage tracker across the full connected market universe, with pair search, two-venue route selectors, hourly-normalized rates, long/short venue routing, gross annualized spread, price-gap checks, and cost-aware break-even
- Live funding adapters for Hyperliquid, Variational, RISEx, Nado, TxFlow, Arcus, and PopDEX; optional Decibel via `DECIBEL_BEARER`
- TxFlow, Arcus, and PopDEX rates come from ProFunding's open market-data endpoint (no API key); price/basis is explicitly shown as unavailable rather than fabricated
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

```bash
npx vercel
npx vercel --prod
```

Set `DECIBEL_BEARER` in Vercel only if the optional authenticated Decibel feed is required.

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

## Accuracy notes

- The delta panel currently uses candle-direction signed volume, **not trade-level CVD**. It is labelled `PROXY` in the UI.
- Regime metrics are descriptive and should not be interpreted as guaranteed trade signals.
- Skyterminal currently monitors data only; order execution is disabled.
- Funding APR is a snapshot extrapolation, not guaranteed yield. Rates can flip, and basis, fees, slippage, liquidity, collateral, and venue risk can dominate the spread.
- The default break-even model assumes `12 bps` combined round-trip cost and should be adjusted before real execution.
