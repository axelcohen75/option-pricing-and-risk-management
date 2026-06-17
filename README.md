# Option Pricer & Risk Management — Black-76

A single-page options desk for **options on futures**, priced with the
**Black-76** model. Unlike a spot-based pricer, you enter the **futures price F
directly** — there is no underlying selection or cost-of-carry step.

Everything runs client-side (vanilla JS + [Plotly](https://plotly.com/javascript/));
just open `index.html`.

## Features

**Pricing & Greeks (Black-76)**
- Multi-leg portfolio builder (calls/puts, long/short, quantity, per-leg IV override)
- Ready-made strategies: straddle, strangle, spreads, butterfly, iron condor, risk reversal, collar
- Greeks-by-leg table: Value, Delta, Gamma, Vega, Theta/day, Rho (+ totals)
- **Payoff diagram**: P&L at expiry, mark-to-market P&L (same IV/DTE), per-leg payoffs
- **Greeks analytics**: Delta / Gamma / Vega / Theta / Rho vs. underlying, total + per-leg
- **3D greek surface**: any greek over Spot × Volatility (or × Time)
- **Theta decay**: portfolio value vs. days to expiry at F, F−10%, F+10%

**Risk management**
- Value-at-Risk (Historical, Parametric Δ-Γ, Monte Carlo) at 1-day and N-day horizons
- CVaR / Expected Shortfall
- Maximum drawdown (Monte Carlo paths): average, 95th percentile, worst-case
- Monte Carlo P&L distribution with VaR marker
- Stress tests: crashes, rallies, vol spikes/crush, time decay, frost / Brazil crisis scenarios

## Model

Black-76 prices a European option on a futures price `F`:

```
d1 = [ln(F/K) + ½σ²T] / (σ√T)        d2 = d1 − σ√T
Call = e^(−rT) [F·N(d1) − K·N(d2)]
Put  = e^(−rT) [K·N(−d2) − F·N(−d1)]
```

Greeks are closed-form (Vega per 1% vol, Theta per calendar day, Rho = ∂Price/∂r).
A per-leg implied-vol override lets you encode the volatility smile/skew.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Layout & controls |
| `style.css`  | Dark teal theme |
| `engine.js`  | Black-76 model, Greeks, portfolio helpers, strategies |
| `app.js`     | UI controller, charts, Monte Carlo risk engine |
