/**
 * Black-76 Pricing Engine for Options on Futures
 *
 * Pure JavaScript — runs entirely in the browser.
 * Black-76 is the standard model for options on a futures/forward price F.
 * Here F is entered directly (no underlying spot / cost-of-carry step).
 */

// ─── Normal distribution helpers ────────────────────────────────────────────

function normCDF(x) {
    if (x === 0) return 0.5;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1.0 / (1.0 + 0.2316419 * x);
    const d = 0.3989422804014327;
    const p = d * Math.exp(-0.5 * x * x);
    const k = ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t -
        0.356563782) * t + 0.319381530) * t;
    return sign === 1 ? 1.0 - p * k : p * k;
}

function normPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2.0 * Math.PI);
}

// ─── Black-76 Model ─────────────────────────────────────────────────────────

const Black76 = {
    d1(F, K, r, sigma, T) {
        if (T <= 0 || sigma <= 0) return 0;
        return (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
    },

    d2(F, K, r, sigma, T) {
        if (T <= 0 || sigma <= 0) return 0;
        return this.d1(F, K, r, sigma, T) - sigma * Math.sqrt(T);
    },

    price(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10) {
            return isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
        }
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return isCall
            ? df * (F * normCDF(d1) - K * normCDF(d2))
            : df * (K * normCDF(-d2) - F * normCDF(-d1));
    },

    delta(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10) {
            if (isCall) return F > K ? 1 : (F === K ? 0.5 : 0);
            return F < K ? -1 : (F === K ? -0.5 : 0);
        }
        const d1 = this.d1(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return isCall ? df * normCDF(d1) : df * (normCDF(d1) - 1);
    },

    gamma(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return df * normPDF(d1) / (F * sigma * Math.sqrt(T));
    },

    vega(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return df * F * normPDF(d1) * Math.sqrt(T) / 100.0;   // per 1% vol move
    },

    theta(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        // θ = r·Price − df·F·N'(d1)·σ / (2√T)
        const diffusion = -df * F * normPDF(d1) * sigma / (2 * Math.sqrt(T));
        let riskFree;
        if (isCall) {
            riskFree = r * df * (F * normCDF(d1) - K * normCDF(d2));
        } else {
            riskFree = r * df * (K * normCDF(-d2) - F * normCDF(-d1));
        }
        return (diffusion + riskFree) / 365.0;               // per calendar day
    },

    rho(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10) return 0;
        const p = this.price(F, K, r, sigma, T, isCall);
        return -T * p;                                        // ∂Price/∂r (per unit r)
    },

    vanna(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return -df * normPDF(d1) * d2 / sigma;
    },

    volga(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        const vegaRaw = df * F * normPDF(d1) * Math.sqrt(T);
        return vegaRaw * d1 * d2 / sigma / 100.0;
    },
};

// ─── Portfolio Helpers ───────────────────────────────────────────────────────

/**
 * Resolve the volatility for a leg: use leg.iv (decimal) if set, else the
 * portfolio-wide sigma. Lets the user encode a smile/skew per option.
 */
function legSigma(leg, fallbackSigma) {
    return (leg && typeof leg.iv === 'number' && isFinite(leg.iv) && leg.iv > 0)
        ? leg.iv
        : fallbackSigma;
}

function computeGreeks(leg, F, r, sigma, T) {
    const K = leg.strike;
    const isCall = leg.type === 'call';
    const sign = leg.position === 'long' ? 1 : -1;
    const qty = leg.quantity || 1;
    const s = sign * qty;
    const o = legSigma(leg, sigma);

    return {
        price:  s * Black76.price(F, K, r, o, T, isCall),
        delta:  s * Black76.delta(F, K, r, o, T, isCall),
        gamma:  s * Black76.gamma(F, K, r, o, T),
        vega:   s * Black76.vega(F, K, r, o, T),
        theta:  s * Black76.theta(F, K, r, o, T, isCall),
        rho:    s * Black76.rho(F, K, r, o, T, isCall),
        vanna:  s * Black76.vanna(F, K, r, o, T),
        volga:  s * Black76.volga(F, K, r, o, T),
    };
}

function portfolioGreeks(legs, F, r, sigma, T) {
    const totals = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0,
                     vanna: 0, volga: 0 };
    for (const leg of legs) {
        const g = computeGreeks(leg, F, r, sigma, T);
        for (const k in totals) totals[k] += g[k];
    }
    return totals;
}

function legPayoff(leg, S) {
    const sign = (leg.position === 'long' ? 1 : -1) * (leg.quantity || 1);
    return leg.type === 'call'
        ? sign * Math.max(S - leg.strike, 0)
        : sign * Math.max(leg.strike - S, 0);
}

function portfolioPayoff(legs, spotRange) {
    return spotRange.map(S => legs.reduce((acc, leg) => acc + legPayoff(leg, S), 0));
}

function portfolioValue(legs, F, r, sigma, T) {
    let val = 0;
    for (const leg of legs) {
        const o = legSigma(leg, sigma);
        const price = Black76.price(F, leg.strike, r, o, T, leg.type === 'call');
        const sign = leg.position === 'long' ? 1 : -1;
        val += sign * (leg.quantity || 1) * price;
    }
    return val;
}

function computeGreekSurface(legs, greek, spotRange, secondRange, secondParam, env) {
    const surface = [];
    for (let i = 0; i < secondRange.length; i++) {
        const row = [];
        for (let j = 0; j < spotRange.length; j++) {
            const r = secondParam === 'risk_free_rate' ? secondRange[i] : env.r;
            const sigma = secondParam === 'volatility' ? secondRange[i] : env.sigma;
            const T = secondParam === 'time_to_expiry' ? secondRange[i] : env.T;
            const g = portfolioGreeks(legs, spotRange[j], r, sigma, T);
            row.push(g[greek] || 0);
        }
        surface.push(row);
    }
    return surface;
}

function linspace(a, b, n) {
    const arr = [];
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) arr.push(a + step * i);
    return arr;
}

// ─── Strategies (built around the current futures price F) ────────────────────

const STRATEGIES = {
    'Straddle': F => [
        { type: 'call', strike: F, position: 'long', quantity: 1 },
        { type: 'put',  strike: F, position: 'long', quantity: 1 },
    ],
    'Strangle': F => [
        { type: 'call', strike: +(F * 1.05).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put',  strike: +(F * 0.95).toFixed(2), position: 'long', quantity: 1 },
    ],
    'Bull Call Spread': F => [
        { type: 'call', strike: F, position: 'long', quantity: 1 },
        { type: 'call', strike: +(F * 1.10).toFixed(2), position: 'short', quantity: 1 },
    ],
    'Bear Put Spread': F => [
        { type: 'put', strike: +(F * 1.10).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put', strike: F, position: 'short', quantity: 1 },
    ],
    'Butterfly': F => [
        { type: 'call', strike: +(F * 0.95).toFixed(2), position: 'long', quantity: 1 },
        { type: 'call', strike: F, position: 'short', quantity: 2 },
        { type: 'call', strike: +(F * 1.05).toFixed(2), position: 'long', quantity: 1 },
    ],
    'Iron Condor': F => [
        { type: 'put',  strike: +(F * 0.90).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put',  strike: +(F * 0.95).toFixed(2), position: 'short', quantity: 1 },
        { type: 'call', strike: +(F * 1.05).toFixed(2), position: 'short', quantity: 1 },
        { type: 'call', strike: +(F * 1.10).toFixed(2), position: 'long', quantity: 1 },
    ],
    'Risk Reversal': F => [
        { type: 'call', strike: +(F * 1.05).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put',  strike: +(F * 0.95).toFixed(2), position: 'short', quantity: 1 },
    ],
    'Collar': F => [
        { type: 'call', strike: +(F * 1.05).toFixed(2), position: 'short', quantity: 1 },
        { type: 'put',  strike: +(F * 0.95).toFixed(2), position: 'long', quantity: 1 },
    ],
};
