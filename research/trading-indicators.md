# Spesifikasi Indikator Dashboard Trading Multi-Market

## Ruang lingkup dan prinsip desain

Dashboard ditujukan untuk aset on-chain lintas **crypto, saham sintetis/tokenized, dan komoditas**, dengan timeframe standar `5m / 1h / 4h / 1d / 1w`. Nomor halaman di bawah adalah **nomor halaman PDF**, bukan nomor halaman cetak.

Prinsip anti-redundansi:

1. **Satu konsep, satu indikator kanonik.** Jangan menampilkan RSI, stochastic, MACD, ROC, dan moving-average crossover sekaligus; semuanya terutama memproksi arah/perubahan harga.
2. **Pisahkan absolute trend dari cross-sectional momentum.** Trend menjawab “aset ini sedang bergerak ke arah mana?”; momentum menjawab “aset ini lebih kuat/lemah daripada peer?”
3. **Pisahkan tiga dimensi likuiditas:** biaya segera (spread), kapasitas (depth/slippage), dan dampak transaksi (impact/shortfall).
4. **Derivatif harus memisahkan level volatilitas, bentuk surface, carry/parity, dan sensitivitas posisi.**
5. **Portfolio harus memisahkan performa, tail risk, drawdown, dan sumber risiko.**
6. **ML bukan indikator harga tambahan.** Panel ML adalah probabilitas regime dan kesehatan model out-of-sample, bukan “AI score” tanpa definisi.

### Klasifikasi bukti

- **Ilmiah/standar kuantitatif:** definisi matematis, model probabilistik, atau metrik pasar/portfolio yang dapat direplikasi.
- **Empiris:** didukung praktik/riset kuantitatif tetapi tetap sensitif terhadap horizon, biaya, dan sampel.
- **Heuristik teknikal:** aturan charting yang implementable tetapi tidak memiliki jaminan statistik; wajib dipisahkan secara visual.

---

## Kontrak data bersama

Semua indikator mengembalikan minimal:

```ts
interface IndicatorPoint {
  assetId: string;
  venueId?: string;
  marketType: "spot" | "perp" | "future" | "option" | "dex" | "synthetic";
  timeframe: "5m" | "1h" | "4h" | "1d" | "1w";
  asOf: string;                 // UTC ISO-8601
  value: number | null;
  unit: string;
  state?: string;
  confidence?: number;         // 0..1, hanya jika terdefinisi
  sampleSize: number;
  stale: boolean;
  qualityFlags: string[];
  params: Record<string, number | string>;
}
```

Aturan lintas pasar:

- Return memakai `r_t = ln(P_t/P_{t-1})` dari harga mark yang konsisten.
- Annualisasi memakai **jumlah bar aktual per tahun untuk kalender aset**, bukan selalu 252. Crypto 24/7 dan tokenized equity yang mengikuti jam bursa tidak boleh disamakan.
- Semua nilai portfolio dikonversi ke reporting currency yang dipilih pengguna.
- Corporate action, redenominasi token, roll futures, funding, rebasing, bridge migration, dan depeg diberi quality flag.
- Untuk DEX, quote spread/depth harus berasal dari simulasi exact-in/exact-out pada blok yang sama; sertakan gas dan fee pool.
- Setiap kartu menampilkan `asOf`, sample size, parameter horizon, dan status stale.

---

# A. Regime

## R1. Volatility Regime Percentile — indikator regime utama MVP

- **Kelas:** ilmiah/standar kuantitatif.
- **Prioritas:** **P0 / MVP**.
- **Tujuan:** membedakan regime volatilitas rendah, normal, tinggi tanpa mengklaim prediksi arah.
- **Formula:**
  - Return: `r_t = ln(P_t/P_{t-1})`.
  - Realized volatility: `RV_t(n) = sqrt(A × Σ_{i=t-n+1}^t r_i²)`; `A` adalah faktor annualisasi per kalender/timeframe.
  - Percentile: `VRP_t = percentile_rank(RV_t(n), {RV_{t-L+1}, …, RV_t})`.
  - State default: `LOW < 20`, `NORMAL 20–80`, `HIGH > 80`. Threshold adalah parameter presentasi, bukan hukum pasar.
- **Input:** harga mark/close bersih, timestamp, kalender perdagangan; default `n=20 bar`, history percentile `L=252 bar ekuivalen`.
- **Output:** `rvAnnualized`, `percentile 0–100`, `LOW/NORMAL/HIGH`, perubahan percentile.
- **Interpretasi:** percentile tinggi = risiko per unit waktu dan kebutuhan sizing/stop lebih tinggi; bukan sinyal short.
- **Keterbatasan:** backward-looking; microstructure noise pada bar pendek; lonjakan tunggal dapat mendominasi; annualisasi tidak berarti distribusi normal.
- **Sumber:** Sheldon Natenberg, *Option Volatility & Pricing*, Bab 14 “Volatility Revisited”, PDF hlm. 288–290 (forecast berbobot, mean reversion, serial correlation, ARCH/GARCH); Ernie Chan, *Quantitative Trading*, Bab 7, PDF hlm. 141–143 (high/low-volatility regime dan regime switching).

## R2. Hidden-Markov Regime Probability — layer probabilistik

- **Kelas:** ilmiah/model probabilistik.
- **Prioritas:** **P1**, setelah data dan validasi stabil.
- **Tujuan:** memberi probabilitas latent state, bukan label deterministik.
- **Algoritma:**
  1. Feature vektor per bar: `[r_t, |r_t| atau RV_t, volume_z, spread_z]`.
  2. Fit Gaussian HMM `K=2` atau `K=3`: transition matrix `A_ij=P(S_t=j|S_{t-1}=i)`, emission `x_t|S_t=k ~ N(μ_k,Σ_k)`.
  3. Gunakan forward-filtered probability `P(S_t=k | x_1…x_t)` untuk live dashboard; jangan memakai smoothed probability yang melihat masa depan.
  4. State diberi nama setelah fit berdasarkan karakteristiknya, misalnya `calm/trending/stressed`, bukan berdasarkan nomor state.
- **Input:** feature tersinkron, training window, minimum 500–1.000 observasi tergantung timeframe.
- **Output:** probabilitas tiap state, most-likely state, transition-risk `1-A_kk`, log-likelihood OOS.
- **Interpretasi:** probabilitas, bukan kepastian; posisi dapat di-scale secara gradual.
- **Keterbatasan:** state-label instability, local optimum, asumsi transition probability relatif stasioner, sangat mudah overfit. Chan secara eksplisit mengingatkan bahwa transition probability konstan sering tidak berguna untuk timing trading.
- **Sumber:** *Machine Learning for Finance*, Bab 7 “Probabilistic Sequence Modeling”, PDF hlm. 243–258 (HMM, Viterbi, state-space); Chan, *Quantitative Trading*, Bab 7, PDF hlm. 141–145 (langkah Markov regime switching dan kritik praktisnya).

**Anti-redundansi regime:** R1 adalah indikator MVP yang transparan. R2 tidak menggantikan R1; R2 menjadi probabilistic overlay. Jangan menambah label regime dari RSI/MACD.

---

# B. Trend dan Momentum

## T1. Volatility-Scaled Time-Series Trend

- **Kelas:** empiris/kuantitatif.
- **Prioritas:** **P0 / MVP**.
- **Tujuan:** mengukur arah absolut aset pada horizon tertentu.
- **Formula:**
  - `R_n(t) = ln(P_t/P_{t-n})`.
  - `TrendScore_t = R_n(t) / (σ_n(t) × sqrt(n))`, dengan `σ_n` deviasi standar return per bar pada window yang sama atau lebih panjang.
  - `direction = sign(TrendScore)`; strength = `clip(|TrendScore|,0,3)/3`.
  - Default horizon: fast `n=20`, slow `n=60`; tampilkan keduanya sebagai satu kartu, bukan dua indikator berbeda.
- **Input:** adjusted/continuous mark price, realized volatility, minimum `2n` bar.
- **Output:** signed score, `UP/DOWN/FLAT`; alignment fast-vs-slow.
- **Interpretasi:** positif = absolute upward trend; skala volatilitas memungkinkan perbandingan lintas BTC, tokenized equity, dan komoditas.
- **Keterbatasan:** reversal risk; hasil sensitif horizon; trend dapat berbeda antar-timeframe; roll/corporate action harus dibersihkan.
- **Sumber:** Chan, *Quantitative Trading*, Bab 7 “Mean-Reverting versus Momentum Strategies”, PDF hlm. 128–131; harga dapat trending pada satu horizon dan mean-reverting pada horizon lain. Bab tersebut juga menjelaskan slow information diffusion dan incremental execution sebagai sumber momentum.

## M1. Cross-Sectional Relative Momentum

- **Kelas:** empiris/kuantitatif.
- **Prioritas:** **P0 / MVP** untuk universe berisi minimal 5 aset sebanding.
- **Tujuan:** mengukur kekuatan relatif terhadap peer, berbeda dari arah absolut T1.
- **Formula:**
  - `Mom_i = ln(P_i,t/P_i,t-n) - ln(B_t/B_{t-n})`, benchmark `B` dapat berupa sector basket atau equal-weight universe.
  - Opsional risk-adjusted: `AdjMom_i = Mom_i / σ_i`.
  - `rankPct_i = rank(AdjMom_i)/(N-1)`.
- **Input:** harga seluruh universe pada timestamp sama, benchmark, membership point-in-time.
- **Output:** percentile rank 0–100, excess return, top/bottom decile.
- **Interpretasi:** rank tinggi = outperformer relatif; aset masih bisa turun secara absolut. Karena itu M1 harus dibaca bersama T1.
- **Keterbatasan:** universe kecil/tidak homogen; survivorship bias; tokenized equity lintas zona waktu memiliki stale-price bias; benchmark choice menentukan hasil.
- **Sumber:** Chan, *Quantitative Trading*, Bab 7, PDF hlm. 128–131; Jeremy du Plessis, *The Definitive Guide to Point and Figure*, bab relative strength, PDF hlm. 355–362. Formula dashboard memakai return relatif yang eksplisit; pola P&F relative-strength dari buku diperlakukan sebagai heuristik, bukan formula utama.

## T2. Point-and-Figure Breakout State — overlay visual opsional

- **Kelas:** **heuristik teknikal**.
- **Prioritas:** **P1**, bukan gate risiko utama.
- **Algoritma:**
  1. Pilih box size `b`, sebaiknya log/percentage box agar lintas harga konsisten.
  2. Bangun kolom X saat harga naik per box dan O saat turun.
  3. Balik kolom hanya setelah pergerakan `reversalBoxes × b`, default 3-box reversal.
  4. Bullish breakout saat kolom X melewati high kolom X sebelumnya; bearish breakdown simetris.
  5. Output age dalam jumlah box dan distance ke invalidation.
- **Input:** high/low atau close; box size; reversal count.
- **Output:** `BULL_BREAKOUT/BEAR_BREAKDOWN/CONGESTION`, box count, invalidation level.
- **Interpretasi:** filter noise berbasis price movement, bukan waktu.
- **Keterbatasan:** pemilihan box/reversal subjektif; tidak punya time scale; target horizontal/vertical count tidak probabilistik; sinyal bisa berbeda antara close-only dan high/low.
- **Sumber:** du Plessis, *The Definitive Guide to Point and Figure*, Bab 2, PDF hlm. 66–97 (box size dan asymmetric 3-box reversal), Bab 3 (signals), Bab 5, PDF hlm. 232–235 untuk vertical count serta peringatan bahwa target tidak memiliki time-scale.

**Jangan ditambahkan pada MVP:** RSI, stochastic, Williams %R, MACD histogram, dan tiga moving-average crossover terpisah. Informasinya sudah tercakup oleh T1/M1 dan hanya menambah voting palsu.

---

# C. Liquidity dan Market Microstructure

## L1. Quoted dan Effective Spread

- **Kelas:** ilmiah/standar market microstructure.
- **Prioritas:** **P0 / MVP**.
- **Formula:**
  - Midquote `m_t=(ask_t+bid_t)/2`.
  - Quoted spread `QS_t=ask_t-bid_t`; basis points `QSbps=10⁴×QS_t/m_t`.
  - Effective spread per trade `ES_t=2×q_t×(p_t-m_t)`, `q=+1` buyer-initiated, `-1` seller-initiated; `ESbps=10⁴×ES_t/m_t`.
  - Untuk DEX: `QS` diganti dengan round-trip executable spread dari quote exact-in kecil setelah fee, termasuk gas sebagai field terpisah.
- **Input:** synchronized bid/ask dan trades; aggressor side; untuk DEX quote buy/sell pada block sama.
- **Output:** median/p90 `QSbps`, volume-weighted `ESbps`, spread widening alert.
- **Interpretasi:** quoted spread = biaya yang terlihat; effective spread = biaya aktual terhadap midpoint.
- **Keterbatasan:** clock mismatch, hidden liquidity, stale quote, MEV/gas, AMM curve, off-chain RFQ. Trade signing dapat salah.
- **Sumber:** Larry Harris, *Trading and Exchanges: Market Microstructure for Practitioners*, bagian transaction-cost measurement, PDF hlm. 437–439; effective spread didefinisikan sebagai dua kali signed liquidity premium dan dapat berbeda dari quoted spread.

## L2. Executable Depth / Slippage Curve

- **Kelas:** ilmiah/standar microstructure.
- **Prioritas:** **P0 / MVP**.
- **Algoritma:** untuk notional standar `Q ∈ {1k,10k,100k}` dalam reporting currency:
  - Simulasikan market buy/sell menembus order book atau AMM route.
  - `VWAP_buy(Q)=Σp_i q_i/Q`.
  - `SlippageBuy_bps(Q)=10⁴×(VWAP_buy(Q)-mid)/mid`; sisi sell simetris.
  - `Depth_50bps` = notional maksimum yang dapat dieksekusi sebelum 50 bps dari mid.
- **Input:** full L2/orderbook atau DEX pool reserves/routes, fee tier, gas, token decimals.
- **Output:** slippage pada ukuran baku, depth within 10/25/50/100 bps, buy/sell asymmetry.
- **Interpretasi:** kapasitas pasar pada ukuran relevan; lebih implementable daripada satu angka “volume”.
- **Keterbatasan:** displayed depth dapat dibatalkan; AMM state berubah intra-block; route competition/MEV; notional standar harus disesuaikan kelas aset.
- **Sumber:** Harris, *Trading and Exchanges*, pembahasan dimensions of liquidity dan depth, PDF hlm. 407–421; market impact meningkat dengan order size, PDF hlm. 85.

## L3. Realized Price Impact / Implementation Shortfall

- **Kelas:** ilmiah/standar execution analytics.
- **Prioritas:** **P0** bila fill data tersedia; selain itu **P1**.
- **Formula:**
  - Decision-price shortfall: `IS = q×(P_fillVWAP-P_decision) + fees + gas + funding_during_execution`, dinyatakan bps terhadap `P_decision`.
  - Realized impact setelah horizon `h`: `Impact_h=10⁴×q×(m_{t+h}-m_t)/m_t`.
  - Temporary component aproksimasi `ESbps-Impact_h`.
- **Input:** parent order, decision timestamp/price, child fills, midpoint saat order dan setelah `h`, fee/gas.
- **Output:** IS median/p90, impact per notional bucket, venue ranking.
- **Interpretasi:** mengukur biaya strategi nyata dan daya serap pasar; berguna untuk memilih venue dan maksimum order size.
- **Keterbatasan:** benchmark choice; market bergerak karena informasi eksternal; selection bias hanya pada filled orders; horizon impact harus konsisten.
- **Sumber:** Harris, *Trading and Exchanges*, market impact PDF hlm. 85; implementation shortfall dan transaction-cost measurement PDF hlm. 437–450. Chan, *Quantitative Trading*, PDF hlm. 44–46 dan 81–89 menekankan biaya transaksi dapat membalik strategi profitable menjadi rugi.

## L4. Order-Book Imbalance — tactical, bukan sinyal standalone

- **Kelas:** empiris/microstructure.
- **Prioritas:** **P1**, hanya untuk venue dengan L2 andal.
- **Formula:** `OBI_k=(Σ_{1..k}BidQty_i-Σ_{1..k}AskQty_i)/(ΣBidQty_i+ΣAskQty_i)`; hitung juga notional-weighted dan distance-weighted.
- **Input:** L2 snapshots konsisten, top-k level atau depth band bps.
- **Output:** `[-1,1]`, persistence, divergence terhadap return.
- **Interpretasi:** positif = displayed buy-side depth lebih besar; gunakan untuk execution timing, bukan prediksi arah jangka panjang.
- **Keterbatasan:** spoofing/cancel; venue fragmentation; AMM tidak mempunyai order book konvensional; tidak comparable tanpa band notional yang sama.
- **Sumber:** Harris, *Trading and Exchanges*, pembahasan order imbalance dan market impact, PDF hlm. 143–147 dan 585–587.

---

# D. Derivatives dan Options

## D1. Implied Volatility Level dan Term Structure

- **Kelas:** ilmiah/standar options.
- **Prioritas:** **P0** bila option chain tersedia.
- **Algoritma:**
  1. Bersihkan quote: bid>0, ask≥bid, minimum open interest/volume, no-arbitrage bounds.
  2. Mid option `C*=(bid+ask)/2`.
  3. Solve `ModelPrice(S,K,T,r,q,σ*)=C*` dengan Brent/bisection; jangan Newton tanpa guard.
  4. Ambil ATM IV per expiry menggunakan forward-moneyness `K/F≈1`.
  5. Term slope `TS=(IV_ATM(T2)-IV_ATM(T1))/(T2-T1)` atau spread langsung dalam volatility points.
- **Input:** option chain, underlying/forward, strike, expiry, rate, dividend/borrow/carry; untuk crypto gunakan forward/perp basis yang relevan.
- **Output:** ATM IV, 7d/30d/90d interpolated IV, term slope, IV percentile terhadap sejarah.
- **Interpretasi:** IV adalah volatilitas yang membuat model cocok dengan harga pasar, bukan forecast murni; term backwardation sering menandakan stress jangka dekat.
- **Keterbatasan:** model-dependent; quote illiquid menghasilkan IV noisy; American exercise/dividend; jump risk; satu IV tidak cocok untuk semua strike.
- **Sumber:** *Investment Analysis and Portfolio Management* ed. 12, options chapter, PDF hlm. 637 dan 655: implied volatility diperoleh dengan search routine dan dapat memuat pricing/trading error. Natenberg, Bab 14, PDF hlm. 288–303: historical-volatility weighting, mean reversion, dan implied-volatility considerations.

## D2. Volatility Skew / Smile

- **Kelas:** ilmiah sebagai pengukuran surface; interpretasi arah tetap empiris.
- **Prioritas:** **P0** setelah D1.
- **Formula default:**
  - Delta-based risk reversal: `RR25(T)=IV_call,25Δ(T)-IV_put,25Δ(T)`.
  - Butterfly/curvature: `BF25(T)=0.5×(IV_call,25Δ+IV_put,25Δ)-IV_ATM`.
  - Jika delta tidak stabil, gunakan slope regresi IV terhadap log-moneyness `k=ln(K/F)` di sekitar ATM.
- **Input:** cleaned IV surface per expiry.
- **Output:** RR25, BF25, smile residual, strike coverage.
- **Interpretasi:** skew menunjukkan perbedaan harga volatilitas downside/upside; bukan probabilitas crash secara langsung.
- **Keterbatasan:** convention delta berbeda; sparse strikes; American options; interpolasi dapat menciptakan bentuk palsu; compare hanya maturity setara.
- **Sumber:** Natenberg, Bab 18 “Models and the Real World”, PDF hlm. 413–414 dan seterusnya: implied volatilities berbeda antar-strike karena kelemahan asumsi model; buku juga membahas jump, skewness, kurtosis, dan volatility skews. TOC PDF hlm. 8 menempatkan “Volatility Skews” pada bab tersebut.

## D3. Portfolio Greeks Exposure

- **Kelas:** ilmiah/standar options risk.
- **Prioritas:** **P0** untuk portfolio options; jika dashboard hanya market-data, **P1**.
- **Formula:** per posisi dan agregat setelah multiplier/quantity:
  - `Delta=∂V/∂S`, `Gamma=∂²V/∂S²`, `Vega=∂V/∂σ`, `Theta=-∂V/∂t` sesuai convention engine.
  - Dollar delta `Δ$=Delta×S×multiplier×qty`.
  - Gamma P&L approximation `0.5×Gamma×(ΔS)²×multiplier×qty`.
  - Vega P&L `Vega×Δσ×multiplier×qty`.
  - Scenario approximation: `ΔV≈Delta·ΔS+0.5·Gamma·ΔS²+Vega·Δσ+Theta·Δt`.
- **Input:** positions, option model, underlying, IV surface, rates/carry, contract multiplier.
- **Output:** net/gross Greeks by underlying dan expiry; scenario grid spot × vol.
- **Interpretasi:** delta = directional sensitivity, gamma = convexity, vega = vol exposure, theta = time decay.
- **Keterbatasan:** local approximation; Greeks berubah saat spot/vol/time berubah; jump/gap dan skew dynamics membuat delta-hedge tidak sempurna.
- **Sumber:** Natenberg, Bab 6, PDF hlm. 110–122; delta didefinisikan sebagai perubahan nilai option terhadap underlying, dilanjutkan gamma/theta/vega. Bab 18, PDF hlm. 398–413 menjelaskan kegagalan asumsi continuous hedging, gap, jump, dan volatility non-constant.

## D4. Carry / Basis / Put-Call Parity Deviation

- **Kelas:** ilmiah/no-arbitrage; implementasi pasar mengandung friksi.
- **Prioritas:** **P1**.
- **Formula:**
  - Futures annualized basis: `BasisAnn=(F/S-1)×yearFraction^{-1}`; gunakan compounding convention yang eksplisit.
  - European put-call parity residual: `PCR=C-P-S+PV(K)+PV(dividends)` atau formulasi forward/carry yang sesuai.
  - Normalisasi `PCR_bps=10⁴×PCR/S` dan kurangi executable fees, borrow, gas, bridge, serta settlement risk.
- **Input:** spot executable price, future/perp/option quotes, expiry, rates, dividends/borrow/carry, funding.
- **Output:** basis curve, funding-adjusted carry, parity residual, executable-arbitrage flag setelah biaya.
- **Interpretasi:** mengukur carry dan konsistensi harga lintas derivatif; parity residual mentah bukan arbitrase tanpa biaya dan kemampuan short/settle.
- **Keterbatasan:** tokenized asset redemption/custody risk, oracle lag, capital controls, borrow unavailable, American exercise, venue counterparty/bridge risk.
- **Sumber:** *Investments* ed. 13, put-call parity, PDF hlm. 721–733; *Investment Analysis and Portfolio Management* ed. 12, options valuation/parity, PDF hlm. 662 dan 677. Natenberg membahas synthetic positions dan arbitrage pada TOC PDF hlm. 6–9.

---

# E. Portfolio dan Risk

## P1. Rolling Sharpe / Information Ratio — satu kartu, dua mode

- **Kelas:** ilmiah/standar performance measurement.
- **Prioritas:** **P0 / MVP**.
- **Formula:**
  - Sharpe: `SR=(mean(r_p-r_f)/std(r_p-r_f))×sqrt(A)`.
  - Information ratio: `IR=(mean(r_p-r_b)/std(r_p-r_b))×sqrt(A)`.
  - Pilih **satu mode**: Sharpe untuk total/dollar-neutral portfolio; IR untuk mandate relatif benchmark.
- **Input:** time-weighted portfolio returns net of fees/funding/gas, risk-free series, benchmark, calendar.
- **Output:** rolling 30/90/365-day ekuivalen, sample count, confidence warning jika autocorrelation tinggi.
- **Interpretasi:** risk-adjusted performance; bukan estimasi return masa depan.
- **Keterbatasan:** non-normal/tail risk, serial correlation, leverage, stale marks, benchmark gaming; annualisasi naive dapat menyesatkan.
- **Sumber:** Chan, *Quantitative Trading*, PDF hlm. 39–41: formula information ratio dan hubungan Sharpe sebagai special case. *Investments* ed. 13, Bab 5, PDF hlm. 170–190 dan formula ringkasan PDF hlm. 21.

## P2. Drawdown State

- **Kelas:** ilmiah/deskriptif.
- **Prioritas:** **P0 / MVP**.
- **Formula:** `Peak_t=max_{u≤t}NAV_u`; `DD_t=NAV_t/Peak_t-1`; `MDD=min_t DD_t`. Tambahkan duration sejak peak dan time-under-water.
- **Input:** NAV net of external cash flow; gunakan chain-linked/TWR series.
- **Output:** current DD, MDD rolling/all-time, duration, recovery needed `Peak/NAV-1`.
- **Interpretasi:** path-dependent capital loss yang tidak terlihat oleh volatility saja.
- **Keterbatasan:** sangat bergantung starting date; mark illiquid meremehkan DD; tidak memberi probabilitas tail berikutnya.
- **Sumber:** Chan, *Quantitative Trading*, PDF hlm. 42–44 dan 65–72; Kevin Davey, *Building Winning Algorithmic Trading Systems*, PDF hlm. 71–83 dan 137–150 membahas maximum drawdown dalam evaluasi dan robustness.

## P3. Historical Expected Shortfall dengan VaR sebagai threshold pendamping

- **Kelas:** ilmiah/standar risk measurement.
- **Prioritas:** **P0 / MVP**.
- **Formula:** dari historical portfolio P&L `L`:
  - `VaR_α = quantile_α(Loss)`.
  - `ES_α = E[Loss | Loss ≥ VaR_α]`.
  - Dashboard menonjolkan **ES**, VaR hanya menunjukkan cutoff; jangan buat dua kartu terpisah.
- **Input:** holdings sekarang, historical asset returns tersinkron, FX, delta/full revaluation untuk derivatif; default `α=97.5%` dan `99%`.
- **Output:** 1d/10d ES sebagai nilai dan % NAV, VaR cutoff, breach count.
- **Interpretasi:** rata-rata loss di tail terburuk sampel; lebih informatif daripada VaR yang berhenti pada quantile.
- **Keterbatasan:** sejarah pendek/regime change; sparse tail; sqrt-time scaling lemah; linear revaluation buruk untuk options; on-chain liquidation/gap tidak tercakup jika tak ada di sampel.
- **Sumber:** *Investments* ed. 13, Bab 5 “Deviations from Normality and Tail Risk”, PDF hlm. 170–190; TOC PDF hlm. 10 secara eksplisit mencantumkan Value at Risk dan Expected Shortfall.

## P4. Risk Contribution dan Concentration

- **Kelas:** ilmiah/portfolio theory.
- **Prioritas:** **P0 / MVP**.
- **Formula:**
  - Portfolio vol `σ_p=sqrt(w'Σw)`.
  - Marginal contribution `MRC_i=(Σw)_i/σ_p`.
  - Component contribution `CRC_i=w_i×MRC_i`; persentase `RC_i=CRC_i/σ_p`.
  - Tambahkan `HHI_risk=ΣRC_i²` dan effective risk bets `N_eff=1/HHI_risk`.
- **Input:** current weights, covariance matrix dengan window/shrinkage terdefinisi, FX-normalized returns.
- **Output:** risk contribution per aset/factor, top contributor, effective risk bets.
- **Interpretasi:** bobot modal kecil dapat menjadi sumber risiko terbesar jika volatilitas/beta tinggi.
- **Keterbatasan:** covariance tidak stabil; nonlinear options perlu scenario/full revaluation; pegged assets dapat mengalami correlation break saat depeg.
- **Sumber:** *Investments* ed. 13, Bab 7 “Efficient Diversification”, PDF hlm. 201–250 (PDF sekitar 245–250 untuk efficient frontier dan covariance framework); *Investment Analysis and Portfolio Management* ed. 12, portfolio theory, PDF hlm. 193–229.

## P5. PCA Factor Concentration

- **Kelas:** ilmiah/statistik multivariat.
- **Prioritas:** **P1**.
- **Algoritma:** standardisasi return, estimasi covariance/correlation, eigendecomposition `Σ=VΛV'`; `PC1Share=λ1/Σλj`, cumulative top-k share, asset loadings.
- **Input:** aligned returns untuk aset liquid, window cukup, missing-data policy eksplisit.
- **Output:** PC1 variance share, top-3 share, dominant loading cluster, perubahan rolling.
- **Interpretasi:** lonjakan PC1 share berarti portfolio yang tampak terdiversifikasi bergerak sebagai satu faktor bersama.
- **Keterbatasan:** linear, sign eigenvector arbitrer, unstable under regime change, sensitive scaling/window; bukan causal factor.
- **Sumber:** Chan, *Quantitative Trading*, Bab 7 factor models/PCA, PDF hlm. 157–160; *Machine Learning for Finance*, Bab 6 “Principal Component Analysis”, PDF hlm. 234–236 dan 260–261.

---

# F. Machine Learning dan Model Governance

## ML1. Walk-Forward Out-of-Sample Health

- **Kelas:** ilmiah/model governance.
- **Prioritas:** **P0** untuk setiap model ML; bukan opsional jika model dipakai live.
- **Algoritma:**
  1. Split berurutan; tidak boleh random shuffle time series.
  2. Untuk fold `j`, train pada `[t0,tj]` atau rolling window, validasi hyperparameter hanya pada data sebelum test, test pada `(tj,tj+h]`.
  3. Gabungkan prediksi OOS yang tidak overlap/leak.
  4. Tampilkan metric sesuai target: regression `MAE/IC`, classification `log-loss/Brier/AUC`, trading `net Sharpe/turnover/drawdown setelah biaya`.
  5. Health ratio: `OOS/IS performance`, serta gap rolling dan sample count.
- **Input:** timestamped features/labels, purge gap sesuai label horizon, biaya transaksi realistis.
- **Output:** OOS metric, IS metric, degradation %, fold dispersion, last refit, live-vs-backtest drift.
- **Interpretasi:** model sehat jika performa OOS konsisten dan biaya sudah masuk; bukan karena training accuracy tinggi.
- **Keterbatasan:** future distribution dapat berbeda sehingga CV bukan jaminan; repeated tuning pada test set mengubah test menjadi training; overlapping labels bocor.
- **Sumber:** *Machine Learning for Finance*, Bab 6 “Time Series Cross-Validation”, PDF hlm. 234 dan 270; pendahuluan PDF hlm. 7–22 menekankan regularization, bias-variance, dan out-of-sample forecasting. Davey, *Building Winning Algorithmic Trading Systems*, walk-forward analysis PDF hlm. 125–141 dan out-of-sample PDF hlm. 63–65.

## ML2. Prediction Calibration dan Uncertainty

- **Kelas:** ilmiah/statistik prediktif.
- **Prioritas:** **P1**.
- **Formula/algoritma:** untuk probabilitas `p_t` dan label `y_t∈{0,1}`:
  - `Brier=mean((p_t-y_t)²)`.
  - Reliability bins: bandingkan mean predicted probability dengan realized frequency.
  - Confidence hanya dipublikasikan jika probabilitas terkalibrasi OOS; jika tidak, field `confidence=null`.
- **Input:** probabilistic OOS/live predictions dan realized labels dengan delay label selesai.
- **Output:** Brier, calibration error, reliability curve, coverage.
- **Interpretasi:** probabilitas 0,7 harus benar kira-kira 70% pada kelompok sejenis; score arah tanpa calibration tidak boleh disebut confidence.
- **Keterbatasan:** calibration drift; sample kecil di extreme bins; label definition menentukan hasil.
- **Sumber:** *Machine Learning for Finance*, bagian probabilistic/Bayesian modeling dan model selection, Bab 2 serta overview PDF hlm. 9–11; Bab 7 HMM PDF hlm. 243–258 menyediakan probabilistic state framework. Spesifikasi Brier/reliability adalah implementasi governance statistik standar, bukan sinyal trading dari buku.

## ML3. Feature/Population Drift

- **Kelas:** ilmiah sebagai monitoring statistik; threshold alert bersifat heuristik.
- **Prioritas:** **P1**.
- **Formula:**
  - Per feature: Population Stability Index `PSI=Σ_b (q_b-p_b) ln(q_b/p_b)` antara reference dan live window.
  - Tambahkan missing rate, clipping rate, dan prediction-distribution drift.
  - Alert threshold dikalibrasi dari historical false-alarm rate; jangan hard-code universal `0.1/0.25` tanpa validasi.
- **Input:** training/reference features dan live features dengan bin edges tetap.
- **Output:** top drifting features, PSI, missing-rate delta, stale feature alert.
- **Interpretasi:** drift memperingatkan model menerima data berbeda dari training; tidak otomatis berarti model salah atau pasar akan berbalik.
- **Keterbatasan:** PSI bergantung binning/sample; correlated features menghasilkan alert berulang; data-source migration dapat tampak seperti market regime.
- **Sumber:** *Machine Learning for Finance*, pendahuluan dan Bab 4–5, PDF hlm. 10–13 untuk supervised learning, regularization, dan feature interpretation; Chan, *Quantitative Trading*, PDF hlm. 24–27 dan 128–145 untuk nonstationarity/regime shift dan bahaya data mining.

---

# G. Susunan Dashboard yang Direkomendasikan

## Baris 1 — Market state

1. **R1 Volatility Regime** — P0
2. **T1 Time-Series Trend** — P0
3. **M1 Relative Momentum Rank** — P0
4. **R2 HMM Probability** — P1, dengan badge `MODEL`
5. **T2 P&F State** — P1, dengan badge `HEURISTIC`

## Baris 2 — Liquidity/execution

1. **L1 Spread**
2. **L2 Slippage/Depth curve**
3. **L3 Implementation Shortfall/Impact**
4. **L4 OBI** hanya bila L2 tersedia

## Baris 3 — Derivatives

1. **D1 ATM IV + term structure**
2. **D2 Skew/smile**
3. **D3 Greeks + scenario grid**
4. **D4 Basis/parity/carry**

## Baris 4 — Portfolio

1. **P1 Sharpe atau IR** sesuai mode
2. **P2 Drawdown**
3. **P3 ES dengan VaR cutoff**
4. **P4 Risk contribution**
5. **P5 PCA concentration** P1

## Baris 5 — Model health

1. **ML1 Walk-forward OOS health**
2. **ML2 Calibration**
3. **ML3 Drift**

---

# H. Prioritas Implementasi

## MVP P0

1. Return/mark-price normalization dan kalender aset.
2. R1 volatility regime.
3. T1 absolute trend dan M1 relative momentum.
4. L1 spread dan L2 executable depth; L3 bila fill history tersedia.
5. D1 IV term structure, D2 skew, D3 Greeks untuk venue options.
6. P1 Sharpe/IR, P2 drawdown, P3 expected shortfall, P4 risk contribution.
7. ML1 walk-forward health untuk model mana pun yang masuk produksi.
8. Quality/staleness flags di semua kartu.

## P1

- R2 HMM regime probability.
- T2 P&F overlay.
- L4 order-book imbalance.
- D4 carry/parity.
- P5 PCA concentration.
- ML2 calibration dan ML3 drift.

## Dihindari

- Composite “buy score” yang menjumlahkan indikator tanpa kalibrasi.
- Banyak oscillator harga yang mengukur fenomena sama.
- Confidence dari softmax mentah atau in-sample accuracy.
- VaR tanpa ES.
- Volume sebagai sinonim liquidity.
- IV tunggal tanpa expiry/strike context.
- P&F target sebagai forecast bertanggal; buku sendiri menegaskan count tidak mempunyai time scale.

---

# I. Acceptance Criteria Teknis

Sebuah indikator dianggap siap produksi hanya bila:

1. Formula dan parameter tersimpan bersama output.
2. Tidak memakai future data; HMM live memakai filtered probability, ML memakai walk-forward OOS.
3. Biaya fee/gas/funding masuk pada metric execution dan model trading.
4. Unit konsisten dan dapat dibandingkan lintas aset.
5. Menangani missing/stale/outlier/corporate action/roll/depeg.
6. Memiliki unit test untuk toy data dengan hasil yang dapat dihitung manual.
7. Memiliki property test: spread/depth non-negatif, probabilities sum to one, risk contributions sum ke portfolio volatility (dalam toleransi), IV solver mereproduksi harga input.
8. Menampilkan sample size dan tidak mengeluarkan state saat minimum data belum terpenuhi.
9. Heuristik diberi label `HEURISTIC`; model statistik diberi label `MODEL`; metrik deskriptif tidak dipasarkan sebagai prediksi.
10. Setiap alert memiliki definisi threshold dan backtest false-positive rate atau dinyatakan sebagai threshold presentasi sementara.

---

## Corpus utama yang dipakai

- Larry Harris — *Trading and Exchanges: Market Microstructure for Practitioners*.
- Ernie Chan — *Quantitative Trading: How to Build Your Own Algorithmic Trading Business*.
- Kevin Davey — *Building Winning Algorithmic Trading Systems*.
- Matthew Dixon, Igor Halperin, Paul Bilokon — *Machine Learning for Finance*.
- Zvi Bodie, Alex Kane, Alan J. Marcus — *Investments*, edisi 13.
- Frank Reilly, Keith Brown, Sanford Leeds — *Investment Analysis and Portfolio Management*, edisi 12.
- Sheldon Natenberg — *Option Volatility & Pricing*.
- Jeremy du Plessis — *The Definitive Guide to Point and Figure*.
