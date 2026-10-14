# Skyterminal — Exocharts Import Summary

- Focus awal: **BTC / ETH / SOL / HYPE**
- Compact templates decoded: **53**
- Workspaces imported: **2**
- Semua source asli dipertahankan di `raw/`; hasil decode ada di `decoded/`.

## Uploaded templates tambahan
- Scalp sDelta LINEAR OKEX — `okex_BTC-USDT-SWAP` — period `41` — visible indicators `[55]`
- Scalp OKEX SRange linear — `okex_BTC-USDT-SWAP` — period `63` — visible indicators `[55]`
- dTPO OKEX extreme inverse — `bybit_BTCUSDT` — period `40` — visible indicators `[]`
- dVolPocket OKEX — `okex_BTC-USD-SWAP` — period `35` — visible indicators `[]`
- dTPO OKEX extreme linear — `bybit_BTCUSDT` — period `40` — visible indicators `[]`
- Scalp OKEX LRange linear — `bybit_BTCUSDT` — period `1013` — visible indicators `[55]`
- Range Charting OKEX Linear — `bybit_BTCUSDT` — period `1011` — visible indicators `[]`
- sTPO OKEX extreme linear — `okex_BTC-USDT-SWAP` — period `27` — visible indicators `[]`
- Scalp  sDelta INVERSE OKEX — `okex_BTC-USDT-SWAP` — period `39` — visible indicators `[55]`
- sTPO OKEX extreme inverse — `okex_BTC-USDT-SWAP` — period `27` — visible indicators `[]`

## Collection 2021
- Exo - 30m PD High/Low — `okex_BTC-USD-SWAP` — period `24`
- Exo - 4H Cryptoleptic — `bitmex_XBTUSD` — period `32`
- Exo - 4H OFA — `bybit_BTCUSD` — period `42`
- Exo - 5min SPOT Delta — `okex_BTC-USDT` — period `24`
- Exo - Daily VP Overview — `bitmex_XBTUSD` — period `36`
- Exo - Dark Stingray Reastruth — `binancefutures_BTCUSDT` — period `16`
- Exo - ETH TPO 3 — `binancefutures_ETHUSDT` — period `16`
- Exo - IMBALANCE R-300 — `okex_BTC-USDT` — period `24`
- Exo - MP Daily BTC — `binancefutures_BTCUSDT` — period `32`
- Exo - MWD Levels Bybit — `bybit_BTCUSD` — period `46`
- Exo - Monthly VP Overview — `bitmex_XBTUSD` — period `38`
- Exo - NightScalper 2 — `bitmex_XBTUSD` — period `16`
- Exo - NightScalper 3 — `bybit_BTCUSD` — period `1005`
- Exo - Obvious 3 — `binancefutures_BTCUSDT` — period `16`
- Exo - Obvious Cluster 2 — `bitmex_XBTUSD` — period `10001`
- Exo - Obvious Cluster ETH — `bybit_ETHUSD` — period `26`
- Exo - Obvious Cluster OP — `bitmex_XBTUSD` — period `26`
- Exo - Obvious Cluster — `bybit_BTCUSD` — period `40`
- Exo - PnF scalper — `bitmex_XBTUSD` — period `7`
- Exo - Range-scalp Okex — `okex_BTC-USD-SWAP` — period `63`
- Exo - SELL TOPS BUY BOTTOMS — `bybit_BTCUSD` — period `55`
- Exo - Scalp Stingray — `binancefutures_BNBUSDT` — period `12`
- Exo - Sentiment Bybit — `bybit_BTCUSD` — period `35`
- Exo - Sentiment Spot — `okex_BTC-USDT` — period `24`
- Exo - Sentiment Swap — `okex_BTC-USD-SWAP` — period `24`
- Exo - Spot-Tracker — `okex_BTC-USDT` — period `21`
- Exo - TPO Aestethic — `bitmex_XBTUSD` — period `28`
- Exo - TPO ColorHeat — `bitmex_XBTUSD` — period `28`
- Exo - TPO ETH 2 — `binancefutures_ETHUSDT` — period `16`
- Exo - TPO Heatmap — `bitmex_XBTUSD` — period `28`
- Exo - TPO POC Follow — `bitmex_XBTUSD` — period `28`
- Exo - TPO Scalp — `bitmex_XBTUSD` — period `79`
- Exo - TPO Sessions — `bitmex_XBTUSD` — period `28`
- Exo - TPO VP DejaBrew — `bitmex_XBTUSD` — period `28`
- Exo - TPO Volume Scalp (Session Zones) — `bybit_BTCUSD` — period `64`
- Exo - TPZero Delta Daily — `bitmex_XBTUSD` — period `28`
- Exo - Trial 4h — `bitmex_XBTUSD` — period `32`
- Exo - VolFx-PF — `bybit_BTCUSD` — period `1000`
- Exo - Weekly VP Overview — `bybit_BTCUSD` — period `47`
- Exo - White PNF 300 — `bitmex_XBTUSD` — period `30`
- Exo - White Stingray 2 — `binancefutures_BTCUSDT` — period `16`
- Exo - White Stingray — `binancefutures_BTCUSDT` — period `15`
- Exo - m/w/d levels — `bitmex_XBTUSD` — period `36`

## Workspaces
- **btc bad/good hands**: 1 panes, 108 unique markets, indicators: Price, CVD SPOT, CVD PERP
- **alts liquidation farming**: 5 panes, 614 unique markets, indicators: pane-specific

## Komponen yang akan diserap ke desain Skyterminal
- CVD spot vs perp lintas venue (good hands / bad hands).
- Scalp delta linear/inverse, long-range dan short-range.
- TPO/dTPO extremes, volume pockets, range charting, P&F, volume profile dan imbalance.
- Liquidation-farming tape layout sebagai referensi scanner multi-aset.
- Template dipakai sebagai referensi konfigurasi/UI; formula final tetap divalidasi terhadap corpus kuantitatif Skyterminal.
