# Rancangan Layer Probabilistic Risk

## 1. Tujuan dan prinsip desain

Layer ini mengubah seri harga menjadi **risiko yang dapat dihitung, diberi interval ketidakpastian, dan dibandingkan lintas aset/timeframe**. Output tidak boleh hanya berupa satu angka; setiap metrik membawa:

- `value`, `unit`, `window`, `horizon`, `as_of`;
- `n_obs`, `n_tail`, `data_quality`;
- `ci_low`, `ci_high`, `confidence_grade`;
- `method`, `parameters`, `warnings`;
- `regime` dan perubahan terhadap periode sebelumnya.

Gunakan log-return bersih dari corporate action untuk saham:

\[
r_t=\log(P_t/P_{t-1}),\qquad L_t=-r_t
\]

`L_t` adalah loss positif. Untuk aset on-chain, pisahkan return pasar dari risiko venue/protokol (depeg, exploit, liquidity withdrawal); metrik probabilistik di bawah mengukur seri harga/PNL, bukan probabilitas exploit.

Landasan corpus: quadratic variation menopang realized variance; Brownian motion memiliki quadratic variation sebesar waktu [Øksendal, Bab II/Exercise 4.7, PDF p.50]. EVT memberi pendekatan parametrik untuk excess di atas threshold melalui generalized Pareto dan estimasi quantile ekstrem [de Haan & Ferreira, §3.1–3.4, PDF pp.79–103; Embrechts–Klüppelberg–Mikosch, §6.4–6.5, PDF TOC pp.8–9]. Distribusi stable non-Gaussian dapat memiliki varians tak hingga, sehingga sample variance dan asumsi Gaussian tidak boleh menjadi satu-satunya alarm risiko [Uchaikin & Zolotarev, Ch. 1 dan §17.7, PDF pp.21–22, 506–509].

> **Catatan minimum data:** angka minimum di bawah adalah guardrail implementasi, bukan teorema dari corpus. Tail metric juga menampilkan `effective_tail_count`; bila jumlah kejadian tail terlalu kecil, UI harus menandai hasil sebagai eksploratif.

---

## 2. Pipeline data

1. **Canonical bars** per `asset × venue × timeframe`: OHLCV, timestamp UTC, status missing/stale, corporate-action adjustment.
2. **Return engine**: log-return, overnight/session return untuk saham/komoditas, continuous 24/7 return untuk crypto.
3. **Quality gate**:
   - duplikasi timestamp, gap, zero/stale price, harga negatif;
   - winsorization **tidak** dilakukan pada raw risk series karena dapat menghapus tail nyata;
   - anomali data dipisahkan dengan flag dan perhitungan dijalankan dalam dua versi: `raw` dan `clean_confirmed`.
4. **Rolling store**: ring buffer untuk window pendek/panjang; snapshot parameter EVT dan bootstrap disimpan terpisah.
5. **Metric workers**:
   - fast path setiap bar: volatility, drawdown, historical VaR/ES, regime state;
   - slow path periodik: Hill/POT, bootstrap CI, threshold diagnostics, stable-tail diagnostics.

Horizon default yang masuk akal:

- intraday: 5m/15m/1h, window 7d dan 30d;
- harian: window 30d, 90d, 252d;
- tail fit: 1–3 tahun ekuivalen atau sebanyak mungkin data homogen yang tersedia.

Jangan mencampur return berbeda frekuensi dalam satu estimator. Agregasi horizon `h` sebaiknya dibentuk dari return aktual `h`-period, bukan selalu dikalikan `sqrt(h)`, karena scaling Gaussian dapat gagal pada heavy tails dan regime shifts.

---

## 3. Metrik inti

### 3.1 Realized volatility

**Formula**

Untuk satu sesi/horizon dengan return intraday `r_{t,j}`:

\[
RV_t=\sum_{j=1}^{m_t} r_{t,j}^2,\qquad \sigma^{RV}_t=\sqrt{RV_t}
\]

Rolling close-to-close:

\[
\hat\sigma_W=\sqrt{A\,\frac{1}{W-1}\sum_{i=t-W+1}^{t}(r_i-\bar r)^2}
\]

`A` adalah annualization factor yang eksplisit per kalender/frekuensi. Realized variance adalah estimator diskret quadratic variation; corpus mendefinisikan quadratic variation sebagai limit jumlah squared increments [Øksendal, Bab II, PDF p.50].

**Estimator praktis**

- Tampilkan `RV_1d`, EWMA volatility, dan rolling 30/90/252-bar volatility.
- EWMA:
  \[
  v_t=\lambda v_{t-1}+(1-\lambda)r_t^2
  \]
  dengan half-life sebagai parameter UI, bukan konstanta tersembunyi.
- Untuk market dengan microstructure noise, sediakan sampling grid lebih jarang dan bandingkan 1m/5m/15m RV.

**Minimum data**

- 20–30 return: hanya indikator cepat dan noisy.
- 60–100 return: baseline operasional.
- 252 daily return: annual view yang lebih stabil.

**Interpretasi**

- Level tinggi = dispersi return tinggi, bukan otomatis arah turun.
- Rasio `vol_short / vol_long` lebih comparable lintas aset daripada level mentah.

**Failure modes**

- microstructure noise, stale ticks, gap pasar, corporate action;
- annualization menyesatkan pada nonstationarity;
- varians dapat tidak stabil/tidak finite pada model stable non-Gaussian [Uchaikin & Zolotarev, PDF pp.21–22].

**Cost**: rolling O(1) per bar dengan sums; O(W) bila dihitung ulang. **MVP: P0.**

---

### 3.2 Tail index

Gunakan loss positif `Y=L` dan urutkan `Y_(1)≤...≤Y_(n)`. Untuk heavy right tail, Hill estimator:

\[
\hat\xi_H=\frac{1}{k}\sum_{i=1}^{k}\left[\log Y_{(n-i+1)}-\log Y_{(n-k)}\right],
\qquad \hat\alpha=1/\hat\xi_H.
\]

Corpus menurunkan Hill dari rata-rata log-excess dan mensyaratkan `k→∞`, `k/n→0` untuk konsistensi asimtotik [de Haan & Ferreira, §3.2, book pp.69–70; PDF pp.83–84].

**Estimator praktis**

- Hitung **terpisah** untuk left tail loss dan right tail gain.
- Jangan pilih satu `k` secara diam-diam. Hitung Hill plot pada grid `k`, misalnya `max(20, 1% n)` sampai `min(20% n, 500)`, lalu cari plateau.
- Laporkan median estimator pada plateau, rentang sensitivitas, dan `k_selected`.
- Cross-check dengan GPD shape `ξ`; `α≈1/ξ` hanya untuk tail Pareto/regular variation dengan `ξ>0`.

**Minimum data**

- hard gate: `n≥500` dan `k≥30`;
- preferred: `n≥1,000`, `50≤k≤200`;
- bila tidak ada plateau, jangan menerbitkan satu angka “valid”; tampilkan `unstable`.

**Interpretasi**

- `α` lebih kecil = tail lebih berat.
- Secara model Pareto: `α≤2` mengindikasikan second moment tidak finite; `α≤1` mean tidak finite. Ini diagnosis model tail, bukan bukti bahwa proses pasar literal memiliki moment tak hingga.

**Failure modes**

- bias–variance dari pilihan `k`; bias dapat mendominasi saat `k` besar dan estimator dapat memberi kesan salah pada sampel moderat [de Haan & Ferreira, akhir §3.2, PDF pp.96–97].
- dependence, volatility clustering, threshold terlalu rendah;
- tail index >2 tidak otomatis membuktikan Gaussian/finite-tail model; corpus mencatat estimator tail dapat memberi nilai >2 pada sampel stable tertentu dan Weibull [Uchaikin & Zolotarev, §17.7, PDF pp.508–509].

**Uncertainty**: asymptotic CI hanya bila plateau dan bias kecil; default gunakan moving-block bootstrap dan threshold-sensitivity band. **Cost**: O(W log W) untuk sort; jalankan periodik. **MVP: P1.**

---

### 3.3 VaR dan CVaR/Expected Shortfall

Untuk confidence `p` dan loss `L`:

\[
VaR_p=F_L^{-1}(p),\qquad ES_p=E[L\mid L\ge VaR_p]
\]

Empirical estimators:

\[
\widehat{VaR}_p=L_{(\lceil np\rceil)},\qquad
\widehat{ES}_p=\frac{1}{N_p}\sum_{i:L_i\ge \widehat{VaR}_p}L_i.
\]

Corpus memperlakukan VaR sebagai quantile P&L dan menghubungkan estimasinya dengan tail/extreme quantiles [Embrechts–Klüppelberg–Mikosch, Reader Guidelines, PDF pp.6–7; Ch. 6, PDF pp.334, 343].

**Estimator praktis**

- P0: historical VaR/ES 95% dan 99% pada return aktual horizon.
- P1: filtered historical simulation: standardisasi return oleh EWMA vol, resample residual, lalu rescale oleh vol terkini.
- P1 EVT/POT: fit GPD pada exceedance `Z=L-u`, jumlah exceedance `N_u`:
  \[
  G_{\xi,\beta}(z)=1-\left(1+\xi z/\beta\right)^{-1/\xi}.
  \]
  Untuk `p>1-N_u/n`:
  \[
  \widehat{VaR}^{POT}_p=u+\frac{\hat\beta}{\hat\xi}
  \left[\left(\frac{n}{N_u}(1-p)\right)^{-\hat\xi}-1\right],
  \]
  dan, bila `ξ<1`,
  \[
  \widehat{ES}^{POT}_p=
  \frac{\widehat{VaR}^{POT}_p+\hat\beta-\hat\xi u}{1-\hat\xi}.
  \]
  Untuk `ξ→0`, gunakan limit eksponensial/log agar numerik stabil.

**Minimum data**

- historical 95%: `n≥250` (hanya ~12 tail observations).
- historical 99%: `n≥1,000`; ES 99% lebih layak dengan `n≥2,000–5,000`.
- Prinsip UI: butuh sedikitnya 20 observasi di luar quantile untuk grade sedang; `expected_tail_count=n(1-p)` selalu ditampilkan.
- POT: `N_u≥50`, preferred `≥100`.

**Interpretasi**

- VaR adalah batas quantile, bukan kerugian maksimum.
- ES menunjukkan rata-rata kerugian setelah VaR dilampaui dan lebih informatif mengenai severity.

**Failure modes**

- sedikit tail observations; serial dependence; regime shift;
- interpolasi quantile berbeda antar library;
- EVT extrapolation sangat sensitif terhadap threshold dan shape;
- ES GPD tidak finite bila `ξ≥1`; tandai `undefined_under_fit`, jangan cap nilainya.

**Cost**: historical quantile O(W log W), atau O(log K) approximate sketch; GPD MLE sekitar O(iterations × N_u). **MVP: historical P0; POT P1.**

---

### 3.4 EVT threshold diagnostics

Exceedance `Z=L-u | L>u` didekati GPD untuk threshold tinggi. Corpus menyatakan excess di atas threshold tinggi dapat dimodelkan GPD dan empirical mean-excess plot membantu memilih threshold [Embrechts–Klüppelberg–Mikosch, Ch. 3 summary, PDF p.178; §6.2.2 dan §6.5, PDF pp.308, TOC pp.8–9].

**Threshold selection pipeline**

1. Kandidat `u_q = quantile(L,q)` untuk `q∈{0.90,0.925,...,0.99}`.
2. Untuk tiap `u` hitung:
   - `N_u`;
   - GPD MLE `(ξ,β)`;
   - standard error/profile likelihood;
   - mean excess:
     \[
     e_n(u)=\frac{\sum_i(L_i-u)\mathbf1(L_i>u)}{\sum_i\mathbf1(L_i>u)};
     \]
   - parameter-stability plot `ξ(u)` dan modified scale `β(u)-ξu`;
   - QQ/PP goodness-of-fit dan exceedance clustering.
3. Pilih threshold terendah pada region tempat mean excess kira-kira linear dan parameter stabil, dengan `N_u≥50`.
4. Ulangi setelah declustering atau block bootstrap; simpan seluruh threshold sensitivity band.

**Interpretasi**: threshold rendah → model bias; threshold tinggi → variance besar. Tidak ada threshold universal lintas aset.

**Failure modes**: plateau palsu, mixture regimes, dependence, bounded tail (`ξ<0`), optimizer gagal. Corpus memperingatkan Hill dapat buruk bila slowly varying component jauh dari konstan [Embrechts–Klüppelberg–Mikosch, Example 4.1.12, PDF pp.201–204].

**Cost**: O(Q × iterations × N_u), Q kecil; refresh harian/4-jam. **MVP: P1.**

---

### 3.5 Drawdown

Untuk equity/index level `V_t`:

\[
H_t=\max_{s\le t}V_s,\qquad DD_t=1-V_t/H_t,
\]

\[
MDD_W=\max_{t\in W}DD_t.
\]

Tambahan implementable:

- `drawdown_duration`: jumlah bar sejak peak terakhir;
- `time_under_water`: proporsi bar `DD_t>0`;
- `drawdown_speed_h = DD_t-DD_{t-h}`;
- `CDaR_q`: mean drawdown di atas quantile ke-`q` dari distribusi `DD_t`.

**Minimum data**: 30 bar untuk current DD; 252 daily bars atau satu siklus pasar untuk MDD yang bermakna.

**Interpretasi**: path-dependent downside stress. Lebih intuitif bagi trader daripada variance, tetapi tidak probabilistik tanpa bootstrap/scenario distribution.

**Failure modes**: sangat tergantung panjang window dan starting point; satu peak lama mendominasi; return series yang tidak adjusted merusak hasil.

**Cost**: current drawdown O(1); exact rolling MDD dapat O(W) atau memakai deque/segment structure. **MVP: P0.**

---

### 3.6 Jump dan tail diagnostics

#### A. Bipower jump diagnostic

Untuk intraday returns:

\[
BV_t=\frac{\pi}{2}\sum_{j=2}^{m}|r_{t,j}||r_{t,j-1}|,
\]

\[
J_t=\max(RV_t-BV_t,0),\qquad JR_t=J_t/RV_t.
\]

Gunakan sebagai **diagnostic**, bukan klaim formal tanpa finite-sample calibration. Quadratic variation memberi dasar pemisahan total path variation; corpus stochastic-process juga membahas proses Poisson/compound Poisson dan small jumps [Varadhan, Ch. 2, book pp.13–21; PDF pp.24–32; Øksendal, quadratic variation, PDF p.50].

Minimum: ≥20 intraday intervals/sesi; preferred ≥78 untuk 5m US session atau grid setara. Failure: microstructure noise, asynchronous trading, price manipulation, opening gap. Cost O(m). **MVP: P1.**

#### B. Exceedance clustering

\[
I_t(u)=\mathbf1(L_t>u),\quad
\hat\lambda_u=\frac{1}{W}\sum I_t(u),\quad
S_{t,m}=\sum_{j=t-m+1}^{t}I_j(u).
\]

`S_{t,m}` adalah moving-window scan count. Runs/scans dipakai untuk mendeteksi non-random ordering dan cluster dalam binary sequence [Balakrishnan & Koutras, Ch. 1 dan Ch. 9, PDF pp.25–31, 316–317].

Alarm bila scan count melampaui quantile bootstrap/null Bernoulli yang sudah dikoreksi untuk dependence. Tambahkan max run of exceedances dan inter-arrival time.

#### C. Subexponential “single big loss” warning

Distribusi subexponential memenuhi asymptotic convolution-tail relation `\bar F^{*2}(x)/\bar F(x)→2`; regularly varying tails adalah kelas penting di dalamnya [Embrechts, Goldie & Veraverbeke, “Subexponentiality and Infinite Divisibility”, §1, PDF p.1]. Implikasi dashboard: agregasi horizon tidak boleh diasumsikan cepat menjadi Gaussian; tampilkan kontribusi kerugian terbesar terhadap total loss:

\[
Dominance_W=\frac{\max(L_i,0)}{\sum_i\max(L_i,0)}.
\]

Ini diagnostic operasional, bukan test formal subexponentiality. **MVP: P1.**

---

## 4. Uncertainty dan confidence layer

### 4.1 Sumber ketidakpastian

Pisahkan empat jenis:

1. **sampling uncertainty**: data terbatas;
2. **parameter uncertainty**: `ξ,β,k,u,λ`;
3. **model uncertainty**: historical vs GPD vs stable/heavy-tail;
4. **regime uncertainty**: proses berubah selama window.

### 4.2 Estimator CI

**Default universal: moving-block bootstrap**

- pilih block length `b` dari grid, misalnya 5–20 daily bars atau setara autocorrelation horizon;
- sample blocks hingga panjang `n`, recompute metric `B=500` untuk dashboard dan `B=2,000` untuk report;
- CI percentile `[q_{α/2},q_{1-α/2}]`;
- untuk intraday, block tidak boleh menyeberangi session boundary tanpa aturan eksplisit.

Minimum operasional untuk bootstrap umum adalah sekitar 100 return, dengan ≥250 lebih baik; tail bootstrap tetap tunduk pada minimum exceedance metrik dasarnya. Biaya komputasi O(B×W) per metrik, sehingga hasil harus di-cache dan dihitung di background.

**VaR nonparametric**: CI rank berdasarkan distribusi binomial/order statistic; tampilkan sebagai rentang quantile, bukan presisi desimal palsu.

**EVT**: profile-likelihood atau parametric/block bootstrap atas `(ξ,β,u)`; CI hanya dari fixed threshold dianggap terlalu optimistis. De Haan & Ferreira membahas asymptotic confidence interval untuk extreme-value index dan menunjukkan bias/variance berubah dengan `k` [§3.7, PDF pp.136–137].

### 4.3 Confidence grade

Skor 0–100:

- 25% data completeness/staleness;
- 25% effective sample/tail count;
- 20% CI relative width;
- 15% threshold/`k` stability;
- 15% model agreement (historical, filtered historical, POT).

Grade:

- A ≥80: cukup data, CI sempit, stabil;
- B 65–79;
- C 45–64: gunakan dengan kehati-hatian;
- D <45: exploratory/insufficient.

Hard warnings mengalahkan skor: `N_tail<20`, `ξ≥1` untuk ES, optimizer gagal, no Hill plateau, data gap besar, atau regime break di tengah window.

**Cost**: bootstrap O(B×W) per metric; background/cache dan jangan jalankan setiap tick. **MVP: CI sederhana P0.5; full bootstrap P1.**

---

## 5. Deteksi regime

### 5.1 Feature vector

Per bar/timeframe:

\[
z^{vol}_t=\log(\sigma_{short}/\sigma_{long}),
\]

\[
z^{tail}_t=\frac{\hat\lambda_u-p_u}{\sqrt{p_u(1-p_u)/W}},
\]

plus `jump_ratio`, `drawdown`, `drawdown_speed`, `ES99 / vol`, max run, dan scan count.

Threshold dinormalisasi terhadap sejarah aset sendiri agar BTC, saham kecil, emas, dan indeks dapat dibandingkan via percentile, bukan level volatility absolut.

### 5.2 MVP state machine

Empat state dengan hysteresis:

- **NORMAL**: semua feature di bawah alert percentile.
- **VOLATILE**: `vol_short/vol_long` tinggi selama ≥2 update.
- **TAIL_STRESS**: exceedance scan/run, jump ratio, atau drawdown-speed melewati critical band.
- **RECOVERY**: tail alarm reda tetapi drawdown belum pulih dan vol masih di atas baseline.

Aturan transisi:

- minimum dwell 3–5 bars;
- entry threshold lebih tinggi daripada exit threshold;
- state confidence = proporsi bootstrap/model votes yang menghasilkan state sama;
- simpan `reason_codes`, misalnya `VOL_RATIO`, `TAIL_CLUSTER`, `JUMP`, `DRAWDOWN_ACCEL`.

Minimum baseline: 100 bar untuk threshold percentile awal, preferred ≥250 bar; bila lebih pendek, gunakan threshold konservatif global tetapi beri grade rendah. Update state/feature rolling O(1) per bar; scan window O(m) secara naif atau O(1) dengan rolling count. Interpretasi state adalah klasifikasi kondisi risiko saat ini, bukan prediksi arah return. Failure modes utama: threshold overfit, chattering tanpa hysteresis, structural break, dan state yang tidak comparable bila normalisasi aset tidak konsisten.

Runs tests menguji randomness/non-random ordering; scan statistics menghitung konsentrasi kejadian dalam moving window dan memiliki aplikasi quality-control [Balakrishnan & Koutras, PDF pp.27, 316–317, 403–404]. Ini cocok untuk alarm cluster tail yang transparan.

### 5.3 Lanjutan

- Hidden Markov Model 2–4 state pada `[return, log RV, exceedance]`;
- Bayesian online change-point;
- extremal index untuk clustering extreme pada dependent series; corpus menyediakan definisi, interpretasi, dan estimasinya [Embrechts–Klüppelberg–Mikosch, §8.1, PDF TOC p.9].

Jangan jadikan HMM sebagai MVP karena label switching, local optimum, dan state yang sulit dijelaskan lintas pasar. **MVP state machine: P0/P1 boundary; HMM: P2.**

---

## 6. Kontrak output/API

Contoh payload:

```json
{
  "asset": "BTC-USD",
  "timeframe": "1d",
  "as_of": "ISO-8601",
  "window": 1000,
  "metrics": {
    "realized_vol": {"value": 0.62, "annualization": 365, "ci": [0.55, 0.70]},
    "var_99": {"value": 0.081, "method": "historical", "tail_count": 10},
    "es_99": {"value": 0.119, "method": "historical", "tail_count": 10},
    "pot": {"u_quantile": 0.95, "n_exceed": 50, "xi": 0.24, "beta": 0.018},
    "drawdown": {"current": 0.17, "max_window": 0.43, "duration_bars": 38},
    "jump": {"rv": 0.0031, "bv": 0.0024, "jump_ratio": 0.226}
  },
  "regime": {
    "state": "TAIL_STRESS",
    "confidence": 0.82,
    "reason_codes": ["TAIL_CLUSTER", "DRAWDOWN_ACCEL"]
  },
  "quality": {
    "grade": "C",
    "warnings": ["VAR99_LOW_TAIL_COUNT"]
  }
}
```

Angka contoh hanya menunjukkan schema, bukan hasil pasar.

---

## 7. UI dashboard

1. **Risk strip**: regime, confidence grade, RV percentile, VaR/ES, current drawdown.
2. **Volatility panel**: RV/EWMA dan short/long ratio dengan CI.
3. **Tail panel**:
   - loss histogram log-scale;
   - Hill plot vs `k`;
   - mean-excess plot;
   - `ξ(u)`, `β(u)-ξu`, exceedance count;
   - historical vs POT VaR/ES.
4. **Path-risk panel**: underwater curve, drawdown duration/speed.
5. **Diagnostics**: RV vs BV, jump ratio, exceedance raster, scan count, max run.
6. Semua tooltip harus menampilkan formula ringkas, window, horizon, sample size, tail count, method, CI, dan warning.

---

## 8. Prioritas implementasi

### P0 — wajib untuk MVP

- canonical returns + data-quality flags;
- rolling/realized volatility dan vol ratio;
- historical VaR/ES 95/99 dengan tail count;
- current/max drawdown, duration, underwater curve;
- regime state machine versi sederhana;
- confidence grade berbasis sample size, freshness, dan basic bootstrap/CI;
- exact reproducibility: method/version/parameters disimpan.

### P1 — sesudah pipeline stabil

- Hill plot dan tail-index stability;
- GPD POT, threshold grid, mean-excess dan parameter-stability diagnostics;
- filtered historical VaR/ES;
- moving-block bootstrap penuh;
- RV/BV jump ratio;
- runs/scan exceedance clustering.

### P2 — riset/advanced

- stable-law fit dan characteristic-function diagnostics;
- extremal index/declustering yang lebih formal;
- HMM/Bayesian change-point;
- multivariate tail dependence, portfolio copula, liquidity-adjusted VaR.

---

## 9. Acceptance tests

- Return, quantile, ES, drawdown, RV/BV diuji dengan fixture kecil yang hasilnya dihitung manual.
- GPD diuji pada synthetic Pareto/GPD: `ξ` dan high quantile pulih dalam tolerance Monte Carlo.
- Gaussian synthetic: jump ratio rendah secara rata-rata; injected jump menaikkan alarm.
- Regime synthetic: variance/tail-rate shift menghasilkan transition dengan hysteresis, tanpa chattering.
- Missing/stale/corporate-action fixtures memunculkan warning dan tidak diam-diam dianggap tail event.
- Deterministic seed untuk bootstrap tests.
- Property checks: `ES_p≥VaR_p`, `VaR_p` nondecreasing terhadap `p`, `0≤DD≤1`, `0≤JR≤1` setelah clipping numerik, dan GPD support `1+ξz/β>0`.

---

## Referensi corpus lokal

1. Laurens de Haan & Ana Ferreira, *Extreme Value Theory: An Introduction* (2006), terutama Ch. 3–4; bagian yang dikutip pada PDF corpus pp.79–136.
2. Paul Embrechts, Claudia Klüppelberg & Thomas Mikosch, *Modelling Extremal Events for Insurance and Finance*, terutama Ch. 3, 6, 8; Ch. 6 dimulai pada PDF corpus p.294 dan §8.1 pada p.424.
3. S. R. S. Varadhan, *Stochastic Processes*, Ch. 2 (Poisson/compound Poisson/small jumps), book pp.13–21; PDF corpus pp.24–32.
4. Bernt Øksendal, *Stochastic Differential Equations: An Introduction with Applications*, quadratic variation, PDF corpus p.50.
5. V. V. Uchaikin & V. M. Zolotarev, *Chance and Stability: Stable Distributions and Their Applications*, Ch. 1, Ch. 9, §17.7; PDF corpus pp.21–22, 253 dst., 506–509.
6. N. Balakrishnan & M. V. Koutras, *Runs and Scans with Applications*, Ch. 1, 9, 12; PDF corpus pp.25–31, 316–317, 403–404.
7. P. Embrechts, C. M. Goldie & N. Veraverbeke, “Subexponentiality and Infinite Divisibility”, §1, PDF corpus p.1.
