# Rancangan indikator macro/cross-asset dan information-theoretic

## Prinsip implementasi bersama

1. **Satu observasi, satu jam jangkar.** Ubah semua harga ke UTC, gunakan close yang sama, dan sediakan horizon 1h/4h/1D/1W. Untuk pasar yang tidak 24/7, panel harian memakai close resmi terakhir dan menandai data stale; jangan mengisi return akhir pekan saham/komoditas dengan nol.
2. **Return yang dibandingkan:** `r_t = ln(P_t/P_{t-1})`, dalam mata uang numeraire yang sama (default USD). Sediakan toggle local-currency versus USD-return agar efek FX tidak tercampur tanpa disadari.
3. **Normalisasi lintas aset:** default robust z-score rolling `z=(x-median)/(1.4826*MAD)`, winsorized ±4; bila satuan/ekor distribusi sangat berbeda, tampilkan percentile rank rolling 0–100. Return komposit di-volatility-scale dengan EWMA realized volatility.
4. **Anti-look-ahead:** data makro memakai timestamp rilis dan vintage yang tersedia saat itu, bukan revisi terakhir. Semua sinyal pada bar `t` hanya memakai data yang sudah tersedia pada akhir bar tersebut.
5. **Tiga lapis UI:** nilai sekarang, sejarah/time series, lalu drill-down kontribusi komponen dan kualitas data. Selalu tampilkan window, jumlah observasi efektif, timestamp pembaruan, serta confidence/coverage.
6. **Catatan metodologis:** rumus dasar di bawah bersumber dari corpus; penggunaan rolling window, robust z-score, percentile, dan komposit adalah adaptasi engineering dashboard, bukan klaim bahwa buku menetapkan parameter tersebut.

---

## 1. Rolling correlation matrix dan correlation regime

**Sumber.** *Investment Analysis and Portfolio Management, 12e*, Bab 6 “An Introduction to Portfolio Management”, khususnya covariance/correlation, halaman cetak 175–176 (PDF hlm. 201–202): korelasi adalah covariance yang distandardisasi oleh produk simpangan baku dan berada pada rentang −1 hingga +1. *Global Macro Trading*, Bab 4, halaman cetak 45–53 (PDF hlm. 57–65), membahas keterkaitan equity, fixed income, FX, dan commodities serta risiko eksposur ganda ketika korelasi meningkat.

**Definisi.** Untuk return aset `i,j` pada window `W`:

`rho_ij = Cov(r_i,r_j)/(sigma_i sigma_j)`.

Tambahkan:
- **level:** korelasi rolling 20/60/120 observasi;
- **change:** `Δrho = rho_short - rho_long`;
- **correlation concentration:** rata-rata absolut off-diagonal;
- **stress correlation:** korelasi bersyarat saat benchmark risk asset berada di kuantil return terbawah 10%.

**Data.** Adjusted prices/continuous futures untuk BTC, ETH, alt basket, S&P 500/Nasdaq/EM equities, Treasury total-return atau yield changes, DXY dan FX majors, gold, oil, copper, credit ETF/spread proxy. Corporate actions dan futures rolls wajib dibersihkan.

**Normalisasi lintas aset.** Pakai log return horizon sama, bukan level harga. Heatmap sudah dimensionless; untuk ranking perubahan gunakan Fisher transform `atanh(rho)` lalu robust z-score terhadap sejarah pasangan itu. Tampilkan minimum overlap dan jangan hitung jika observasi efektif kurang dari 30.

**Interpretasi.** `rho≈+1` berarti bergerak searah secara linear; `rho≈−1` berlawanan; lonjakan mean-absolute-correlation menunjukkan diversifikasi lintas aset sedang menyusut. Korelasi risk assets yang serempak naik ketika pasar turun adalah tanda stress, bukan otomatis peluang directional.

**Batasan.** Korelasi linear, tidak stabil, sensitif terhadap horizon/outlier, dan dapat berubah hanya karena volatilitas regime. Korelasi bukan sebab-akibat; confounder dapat menciptakan korelasi semu (*Patterns, Predictions, and Actions*, bab causal inference, halaman cetak 183–187; PDF hlm. 193–197).

**Prioritas MVP:** **P0**. Panel inti: heatmap 60D, sparkline 20/60/120D, mean absolute correlation, dan data-quality badge.

---

## 2. Dynamic beta dan residual/alpha map

**Sumber.** *Foreign Exchange: Practical Asset Pricing and Macroeconomic Theory*, Bab 1 §1.7, halaman cetak 32–34 (PDF hlm. 45–47): expected excess return dihubungkan dengan regression beta terhadap market portfolio; praktisi mengestimasi regresi excess return aset terhadap excess return indeks pasar. Buku juga menginterpretasikan beta negatif sebagai karakter hedge/safe haven.

**Definisi.** Pada window `W`:

`r_i,t - r_f,t = alpha_i + beta_i (r_B,t - r_f,t) + epsilon_i,t`.

Sediakan benchmark yang bisa dipilih: global equities, BTC, broad commodity, duration, atau risk-on composite. Turunan UI:
- rolling beta;
- `R²`/fit quality;
- residual return dan residual volatility;
- downside beta, dihitung hanya saat benchmark negatif.

**Data.** Total return aset dan benchmark; risk-free rate yang sesuai horizon/numeraire; untuk crypto intraday dapat memakai stablecoin/T-bill proxy tetapi harus dilabeli sebagai proxy.

**Normalisasi lintas aset.** Beta dimensionless. Bandingkan hanya beta dengan benchmark dan horizon yang sama. Winsorize return, tampilkan percentile historis beta, dan gunakan volatility floor agar beta tidak meledak ketika variance benchmark sangat kecil.

**Interpretasi.** Beta >1: sensitivitas lebih besar daripada benchmark; beta <0: cenderung bergerak berlawanan dan berpotensi berfungsi sebagai hedge. Residual positif berarti outperform setelah eksposur benchmark, bukan “alpha” struktural tanpa uji lebih lanjut.

**Batasan.** Beta bergantung benchmark/window, tidak menangkap nonlinearity, berubah saat stress, dan OLS terdistorsi outlier/serial correlation. `R²` rendah berarti angka beta tidak boleh diberi confidence tinggi.

**Prioritas MVP:** **P0** untuk beta + `R²`; downside beta **P1**.

---

## 3. Relative strength (RS) lintas aset

**Sumber.** *Investment Analysis and Portfolio Management, 12e*, Bab 5, halaman cetak 154–155 (PDF hlm. 180–181): RS ratio adalah harga aset/indeks dibagi indeks pasar; rasio naik berarti outperform, dan konsep berlaku baik pada pasar naik maupun turun.

**Definisi.** `RS_i/B(t)=P_i(t)/P_B(t)` atau lebih stabil `logRS=ln P_i−ln P_B`. Fitur:
- slope logRS 20/60/120D;
- breakout percentile dari logRS;
- RS momentum = perubahan logRS;
- ranking cross-sectional per horizon.

**Data.** Harga adjusted/total-return aset dan benchmark yang serasi. Untuk token, gunakan spot composite volume-weighted; untuk futures gunakan back-adjusted continuous series.

**Normalisasi lintas aset.** Karena level rasio arbitrer, bandingkan slope, perubahan persen, robust z-score terhadap sejarah sendiri, atau percentile rank cross-sectional. Untuk aset dengan volatilitas berbeda, bagi slope logRS dengan realized volatility residual terhadap benchmark.

**Interpretasi.** RS naik = aset outperform benchmark, termasuk ketika keduanya turun tetapi aset turun lebih sedikit. Konfirmasi terbaik bila slope 20D dan 60D searah dan harga/volume tidak menunjukkan data stale.

**Batasan.** Sangat bergantung pemilihan benchmark dan starting point; momentum dapat berbalik; token tipis dapat tampak kuat karena likuiditas buruk. RS adalah perbandingan performa, bukan valuasi.

**Prioritas MVP:** **P0**.

---

## 4. Risk-on/risk-off composite dan breadth

**Sumber.** *Foreign Exchange*, Bab 1, halaman cetak 11 (PDF hlm. 24), mendefinisikan kenaikan risk aversion sebagai risk-off dan penurunannya sebagai risk-on. Bab 3 §3.6.2, halaman cetak 89–93 (PDF hlm. 101–105), menggambarkan risk-off sebagai nominal yields, equities, dan commodities turun; risky currency melemah dan safe-haven currency menguat. *Global Macro Trading*, Bab 4, halaman cetak 51–52 (PDF hlm. 63–64), menyebut risk-on ketika equities, oil, copper, dan commodity currencies reli bersama, sekaligus menekankan hubungan ini tidak selalu berlaku.

**Definisi.** Bangun faktor bertanda:

`RO = weighted_mean(z(vol_scaled_return_k) * sign_k)`

Komponen awal:
- + global equities, EM equities, BTC/ETH, copper, oil, high-yield credit, AUD/JPY atau basket commodity FX;
- − safe-haven FX, Treasury duration return, gold hanya bila secara empiris loading-nya negatif pada window terkait;
- − perubahan implied volatility dan credit spread (karena kenaikan keduanya risk-off).

Tambahkan **breadth** = persentase komponen yang memberi vote risk-on, dan **dispersion** = simpangan antar-vote.

**Data.** Return, yield changes/total return, credit spreads, implied volatility, FX; untuk crypto: BTC/ETH, alt breadth, perp funding, stablecoin demand/liquidity proxy.

**Normalisasi lintas aset.** Volatility-scale tiap return (`r/vol_EWMA`), robust z-score per seri, orientasikan tanda secara eksplisit, lalu bobot sama per sleeve agar 20 token tidak mengalahkan satu sleeve equity. Skor akhir dipetakan ke −100…+100 memakai percentile historis.

**Interpretasi.** Skor tinggi + breadth tinggi = risk-on terkonfirmasi luas. Skor ekstrem tetapi breadth rendah = reli sempit/divergence. Perubahan skor lebih berguna daripada label statis.

**Batasan.** Safe haven dapat gagal pada inflation shock; gold dan USD dapat berganti peran; bank sentral atau shock negara-spesifik memutus hubungan umum. Hindari hard-coded korelasi permanen: tanda komponen strategis tetap, tetapi dashboard harus menampilkan rolling loading aktual.

**Prioritas MVP:** **P0** dengan 8–12 seri likuid; conditional/stress weights **P1**.

---

## 5. Carry, forward/futures basis, dan funding

**Sumber.** *Foreign Exchange*, Bab 2 “FX Forwards and the Carry Trade”, halaman cetak 37–46 (PDF hlm. 50–59). §2.1 memberi CIP `F=S exp((r_d−r_f)τ)`; halaman cetak 41 (PDF hlm. 54) mendefinisikan cross-currency basis sebagai deviasi forward pasar dari forward CIP. §2.2–2.3 membedakan carry dari expected carry-trade profit dan menunjukkan forward = expected future spot + risk premium.

**Definisi.**

**FX CIP basis:**
`basis_CIP = [ln(F_CIP)−ln(F_market)]/τ`, dengan `F_CIP=S exp((r_d−r_f)τ)`.

**Futures/perpetual crypto (adaptasi no-arbitrage yang sama):**
- annualized dated-futures basis: `b = ln(F/S)/τ`;
- excess basis: `b_excess = b − (funding_currency_yield − asset_carry_yield − storage/borrow proxy)`;
- perp carry: realized/expected annualized funding, selalu dari sudut posisi yang jelas;
- carry-to-risk: `annualized net carry / realized vol`;
- curve slope: basis tenor panjang − tenor pendek.

**Data.** Spot mid, futures/perp mark dan expiry, funding history/next funding, borrow/lending rates, stablecoin/T-bill yield, fees, slippage, margin haircuts; FX memerlukan spot, forwards/swaps, dua kurva suku bunga.

**Normalisasi lintas aset.** Semua carry dinyatakan annualized continuously compounded, sesudah fees/borrow estimate. Bandingkan juga carry-to-vol dan percentile terhadap sejarah instrumen; jangan membandingkan raw 8-hour funding dengan annual basis tanpa annualisasi yang konsisten.

**Interpretasi.** Basis positif = futures premium terhadap spot; basis sangat tinggi dapat menunjukkan demand leverage, tetapi bukan expected return bebas risiko. Deviasi dari fair carry menunjukkan friksi pendanaan/balance sheet atau risiko yang dihargai pasar. Carry positif dengan basis mulai turun dapat menandakan crowding sedang unwind.

**Batasan.** Funding berubah cepat; mark price dapat berbeda dari executable price; borrow dapat hilang; biaya modal/margin, liquidation, counterparty, tax, dan roll tidak tercakup oleh spread mentah. Pada crypto, analog CIP tidak sempurna karena fragmentasi venue dan risiko stablecoin/custody.

**Prioritas MVP:** **P0** untuk annualized basis, funding, curve, carry-to-vol; fair-value excess basis multi-venue **P1**.

---

## 6. Shannon entropy / entropy-rate proxy

**Sumber.** Cover & Thomas, *Elements of Information Theory*, Bab 2 “Entropy, Relative Entropy, and Mutual Information”, halaman cetak 13–20 (PDF hlm. 33–40): entropy mengukur uncertainty/average information. Bab 4 §4.2, halaman cetak 74–76 (PDF hlm. 92–94), mendefinisikan entropy rate sebagai pertumbuhan entropy per simbol dan mengaitkannya dengan conditional entropy terhadap masa lalu untuk proses stasioner.

**Definisi.** Diskretisasi return volatility-scaled ke `K` state berbasis quantile training (mis. strong-down/down/flat/up/strong-up):

`H = −Σ p_k log p_k`, `H_norm = H/log K`.

Tambahkan conditional entropy orde-1:
`H1 = H(X_t | X_{t−1})`, dan **predictability gap** `PG = 1 − H1/log K` sebagai proxy keteraturan transisi, bukan prediksi profit.

**Data.** Return bersih, cukup panjang untuk estimasi state; opsional volume/volatility state terpisah. Batas bin harus ditetapkan dari trailing training window dan dibekukan sepanjang evaluation window.

**Normalisasi lintas aset.** Gunakan `H/log K` agar 0–1; `K`, horizon, dan window harus sama. Tampilkan Miller-Madow/bootstrap bias estimate atau minimal confidence interval bootstrap dan jumlah observasi per state.

**Interpretasi.** `H_norm` tinggi = distribusi state lebih merata/uncertain; rendah = observasi terkonsentrasi pada sedikit state. Conditional entropy rendah relatif terhadap unconditional entropy menunjukkan dependensi sekuensial lebih besar.

**Batasan.** Sangat sensitif pada binning, window, sample kecil, dan nonstationarity. Entropy rendah dapat disebabkan pasar diam/illiquid, bukan tren yang dapat diperdagangkan. Differential entropy raw untuk return kontinu tidak comparable lintas skala; karena itu MVP memakai state diskret.

**Prioritas MVP:** **P0** untuk `H_norm`; conditional entropy/entropy-rate proxy **P1**.

---

## 7. Distribution shift: KL divergence

**Sumber.** Cover & Thomas, Bab 2 §2.3, halaman cetak 19–20 (PDF hlm. 39–40): relative entropy/Kullback–Leibler divergence `D(p||q)=Σp log(p/q)` mengukur inefisiensi memakai distribusi `q` ketika distribusi sebenarnya `p`, non-negatif tetapi tidak simetris dan bukan distance metric sejati.

**Definisi.** Bandingkan distribusi state recent `p` (mis. 20D) dengan baseline `q` (mis. trailing 252D, tidak termasuk recent):

`KL_recent||base = Σ p_k log(p_k/q_k)`.

Gunakan additive smoothing kecil dan tampilkan dua arah secara terpisah atau label jelas bahwa metrik asimetris. Fitur dashboard: current KL, percentile, dan kontribusi state `p_k log(p_k/q_k)`.

**Data.** State return/volatility/liquidity yang didefinisikan konsisten; baseline cukup besar dan bebas look-ahead.

**Normalisasi lintas aset.** Jangan membandingkan KL mentah jika `K/window` berbeda. Gunakan percentile historis per aset dan bootstrap significance; UI 0–100 adalah percentile, bukan nilai KL yang “dinormalisasi secara universal”.

**Interpretasi.** Lonjakan KL = distribusi recent tidak menyerupai baseline; kontribusi state menunjukkan apakah pergeseran berasal dari crash, volatilitas tinggi, atau dominasi arah tertentu.

**Batasan.** Zero-probability membuat KL tak hingga sehingga smoothing wajib; asimetri mudah disalahartikan; hasil sensitif terhadap bins dan baseline. Pergeseran distribusi tidak memberi arah dengan sendirinya.

**Prioritas MVP:** **P1**.

---

## 8. Mutual-information dependency dan lead/lag map

**Sumber.** Cover & Thomas, Bab 2 §2.3–2.4, halaman cetak 19–22 (PDF hlm. 39–42): mutual information adalah relative entropy antara joint distribution dan produk marginal serta sama dengan pengurangan uncertainty satu variabel setelah mengetahui variabel lain. §2.8, halaman cetak 34–35 (PDF hlm. 54–55), memberi data-processing inequality: pemrosesan data tidak dapat menambah informasi inferensial. *Patterns, Predictions, and Actions*, halaman cetak 183–187 (PDF hlm. 193–197), membedakan observation dari action dan menunjukkan confounding dapat menciptakan korelasi.

**Definisi.** Untuk state diskret aset `X` dan faktor `Y`:

`I(X;Y)=Σ p(x,y) log[p(x,y)/(p(x)p(y))]`.

Normalisasi dashboard:
`NMI = I(X;Y)/sqrt(H(X)H(Y))`.

Lead/lag exploratory map menghitung `NMI(X_t;Y_{t−l})` untuk lag yang telah ditentukan (mis. −10…+10 bars), lalu melaporkan peak lag hanya jika stabil pada subwindow dan lolos permutation-test threshold.

**Data.** Return/state tersinkronisasi, macro-surprise series bertimestamp rilis, on-chain flows dengan waktu observasi sebenarnya, serta jumlah sampel cukup untuk joint table.

**Normalisasi lintas aset.** State quantile yang sama jumlahnya, NMI 0–1, minimum cell count, bias correction/permutation null. Ranking memakai excess NMI di atas median shuffled null, bukan NMI mentah.

**Interpretasi.** NMI tinggi = dependensi, termasuk nonlinear, lebih kuat. Peak pada `Y_{t−l}` berarti Y secara statistik mendahului X pada sampel, **bukan** membuktikan kausalitas.

**Batasan.** Estimator bias pada sample kecil; multiple-lag search menghasilkan data snooping; sinkronisasi pasar 24/7 versus jam bursa dapat membuat lead palsu; common driver/confounder tetap mungkin. MI tidak memberi tanda positif/negatif, sehingga harus dipasangkan dengan conditional return atau signed correlation.

**Prioritas MVP:** **P1**; P0 cukup correlation/beta. Jangan menjadikan peak-lag otomatis sebagai sinyal trading.

---

## 9. Macro regime engine

**Sumber.** *Investment Analysis and Portfolio Management, 12e*, Bab 9 §9.2.1, halaman cetak 301–304 (PDF hlm. 327–330), membagi indikator menjadi leading, coincident, dan lagging; leading mencapai puncak/lembah sebelum aktivitas agregat, coincident kira-kira bersamaan, lagging sesudahnya. Halaman cetak 306–310 (PDF hlm. 332–336) membahas real policy rate, term spread/yield curve, dan credit risk premium; yield curve diperlakukan sebagai leading market-price indicator bagi growth expectations.

**Definisi.** Dua sumbu utama, masing-masing memakai **level** dan **momentum**:
- `Growth`: kombinasi macro surprises/nowcast dari leading indicators (new orders, claims terbalik, housing/building, term spread, equity breadth) dan konfirmasi coincident (payroll, industrial production, real income/sales).
- `Inflation`: CPI/PCE/core trend, breakeven/inflation swap, commodity input trend, wage/unit-labor-cost; gunakan surprise versus consensus serta momentum.

Klasifikasi probabilistik empat regime:
1. growth↑ / inflation↓ = disinflationary expansion;
2. growth↑ / inflation↑ = inflationary expansion;
3. growth↓ / inflation↑ = stagflationary slowdown;
4. growth↓ / inflation↓ = contraction/disinflation.

Overlay ketiga: **policy/liquidity stance** = real policy rate minus neutral-rate estimate (jika tersedia), yield-curve slope, credit spread, dan financial-conditions proxy.

**Data.** Kalender rilis, actual/consensus/previous/vintage, PMI/new orders, claims, payroll, industrial production, retail/real income, CPI/PCE, wages, yield curves, breakevens, credit spreads, equities/commodities. Untuk global dashboard, hitung per negara lalu agregat GDP-weighted atau trade-weighted.

**Normalisasi lintas aset/negara.** Macro surprise = `(actual−consensus)/historical forecast-error SD`, orientasi tanda agar positif selalu “growth lebih kuat” atau “inflation lebih tinggi”. Slow-moving level memakai robust z-score 5–10 tahun; market series memakai 1–3 tahun. Agregasi per sleeve mencegah banyak seri inflasi menguasai growth.

**Interpretasi.** Tampilkan probabilitas regime, perubahan 1M, dan kontribusi data. Leading menentukan early call; coincident mengonfirmasi; lagging tidak boleh dipakai sebagai pemicu awal. Mapping asset response harus empiris dan conditional, bukan tabel deterministik.

**Batasan.** Revisi data, publication lag, perbedaan struktur negara, neutral rate yang tidak terobservasi, dan shock supply dapat merusak mapping historis. Regime transition sering gradual dan probabilitas harus boleh “uncertain”.

**Prioritas MVP:** **P0** versi sederhana: growth/inflation momentum + yield curve + credit spread, empat regime dan confidence. Vintage-aware probabilistic model **P1**.

---

## 10. Cross-market confirmation dan divergence monitor

**Sumber.** *Global Macro Trading*, Bab 4, halaman cetak 45–53 (PDF hlm. 57–65): pemahaman hubungan FX, equities, fixed income, commodities dianggap penting; risk-on dicirikan partisipasi serentak equity, oil, copper, dan commodity currencies, tetapi hubungan tidak selalu berlaku karena shock spesifik. *Investment Analysis and Portfolio Management*, Bab 9 halaman cetak 301–304 (PDF hlm. 327–330), menyatakan coincident/lagging data berguna untuk mengonfirmasi data dan keyakinan yang sudah ada.

**Definisi.** Untuk suatu hipotesis tema (risk-on, reflation, USD shortage, crypto leverage expansion), tetapkan expected sign per pasar. Tiap komponen memberi vote:

`vote_k = sign(expected_k × standardized_move_k)`.

`confirmation breadth = Σw_k 1(vote_k>threshold)/Σw_k`.

`confirmation score = Σw_k clipped(z_k × expected_sign_k)/Σw_k`.

`divergence = anchor_signal − median(confirmers)`.

Contoh tema:
- **risk-on:** equities+, copper+, oil+, commodity FX+, credit spread−, implied vol−;
- **growth slowdown:** cyclicals/defensives RS−, copper−, term spread flattening/inversion, credit spread+;
- **crypto leverage expansion:** BTC/ETH+, alt breadth+, basis/funding+, OI+, stablecoin liquidity+; beri warning bila harga naik tetapi breadth turun dan funding/OI terlalu ekstrem.

**Data.** Semua pasar pada kategori di atas; metadata jam perdagangan dan staleness; untuk confirmation intraday, hanya gunakan pasar yang sedang terbuka atau price discovery proxy yang valid.

**Normalisasi lintas aset.** Volatility-scaled standardized moves, equal weight per sleeve, sign orientation per tema. Confidence = breadth × coverage × stability, dengan coverage mengurangi skor ketika pasar tutup/stale.

**Interpretasi.** Skor dan breadth tinggi = narasi didukung banyak pasar independen. Anchor naik tetapi confirmers tidak ikut = divergence/fragile move. Dashboard harus menunjukkan siapa yang mengonfirmasi dan siapa yang menyimpang, bukan hanya satu lampu hijau/merah.

**Batasan.** Komponen tidak independen; banyak aset hanya mereplikasi faktor yang sama. Shock idiosinkratik, bank sentral, inventory, atau geopolitik dapat mematahkan expected sign. Divergence dapat bertahan lama dan bukan timing signal mandiri.

**Prioritas MVP:** **P0** untuk risk-on dan crypto-leverage themes; theme builder kustom **P1**.

---

## Susunan MVP yang disarankan

### P0 — rilis pertama
1. **Cross-asset matrix:** return, volatility, rolling correlation 60D, beta + `R²`.
2. **Relative strength:** log-RS 20/60/120D dan cross-sectional rank.
3. **Risk regime:** risk-on/off score, breadth, dispersion, kontribusi sleeve.
4. **Carry:** annualized futures basis, perp funding, curve, carry-to-vol.
5. **Information:** normalized Shannon entropy pada return states.
6. **Macro:** growth/inflation four-quadrant, term spread, credit spread, confidence.
7. **Confirmation:** risk-on dan crypto-leverage breadth/divergence.

### P1 — setelah validasi data dan backtest
- downside/stress beta dan conditional correlation;
- conditional entropy/entropy-rate proxy;
- KL distribution-shift alert;
- lagged NMI network dengan permutation tests;
- vintage-aware probabilistic macro regime;
- fair-value/excess basis lintas venue dan FX CIP basis;
- custom theme builder.

### P2 — riset lanjutan
- hidden-state/regime model dengan transition probabilities;
- causal graph yang eksplisit untuk menguji confounder, bukan hanya dependency map;
- execution-aware carry after margin, borrow, liquidation, dan venue risk;
- regime-conditioned asset response learned out-of-sample.

## Guardrail produk

- Label **descriptive**, **confirmatory**, dan **predictive** secara terpisah. Correlation, entropy, KL, dan MI default-nya descriptive; jangan dipasarkan sebagai forecast tanpa validasi out-of-sample.
- Setiap card menampilkan formula, window, universe, timestamp, coverage, dan data revisions.
- Semua threshold dikalibrasi dari training period dan dibekukan untuk test/live period.
- Alert hanya aktif bila magnitude, persistence, coverage, dan statistical confidence terpenuhi; satu print ekstrem tidak cukup.
- Backtest wajib memasukkan asynchronous closes, futures rolls, funding/borrow, fees, slippage, dan data-release timestamps.

## Daftar sumber PDF corpus

- Adam S. Iqbal, *Foreign Exchange: Practical Asset Pricing and Macroeconomic Theory* (2022): Bab 1, 2, 3; PDF hlm. 24, 45–59, 101–105.
- Sanford Leeds, Frank Reilly, Keith Brown, *Investment Analysis and Portfolio Management*, 12e: Bab 5, 6, 9; PDF hlm. 180–181, 201–202, 327–336.
- Greg Gliner, *Global Macro Trading: Profiting in a New World Economy*: Bab 4; PDF hlm. 57–65.
- Thomas M. Cover & Joy A. Thomas, *Elements of Information Theory*, 2e: Bab 2 dan Bab 4; PDF hlm. 33–55 dan 92–94.
- Moritz Hardt & Benjamin Recht, *Patterns, Predictions, and Actions*: bab causal inference; PDF hlm. 193–197.
