/**
 * Option Pricer & Risk Management — UI Controller (Black-76, direct futures price)
 */

// ─── State ───────────────────────────────────────────────────────────────────

let portfolio = [];
let activeMetrics = ['delta'];

const UNIT = '¢/lb';                       // ¢/lb

// teal-green primary, amber secondary, muted leg colors
const LINE_COLORS = ['#2dd4bf', '#f0a868', '#6b86b8', '#a78bfa', '#f87171', '#f472b6'];
const LEG_COLORS  = ['#6b86b8', '#a78bfa', '#d98fb5', '#7fb8a0', '#c0a060', '#8fa8d0'];

const ALL_METRICS = ['payoff', 'price', 'delta', 'gamma', 'vega', 'theta', 'rho', 'vanna', 'volga'];

function getChartColors() {
    return {
        bg: '#0b1017', grid: '#18222e', zero: '#26323f',
        text: '#c8d2dc', muted: '#5f6f7e', dim: '#3f4c59',
        accent: '#2dd4bf', accent2: '#f0a868',
        zeroLine: 'rgba(95,111,126,0.35)',
        sweepColor: (a) => `rgba(45,212,191,${a})`,
        surfaceHighlight: '#2dd4bf',
    };
}

function getChartLayout() {
    const c = getChartColors();
    return {
        paper_bgcolor: c.bg,
        plot_bgcolor: c.bg,
        font: { color: c.text, family: 'JetBrains Mono, monospace', size: 11 },
        xaxis: { gridcolor: c.grid, zerolinecolor: c.zero, tickfont: { size: 10, color: c.muted } },
        yaxis: { gridcolor: c.grid, zerolinecolor: c.zero, tickfont: { size: 10, color: c.muted } },
        margin: { l: 55, r: 55, t: 25, b: 40 },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 9, color: c.muted }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
        hovermode: 'x unified',
    };
}

let CHART_LAYOUT = getChartLayout();

const CHART_CONFIG = {
    displayModeBar: true,
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
};

// ─── Slider definitions ─────────────────────────────────────────────────────

const SLIDERS = [
    { id: 'futures-price',  decimals: 1 },
    { id: 'time-to-expiry', decimals: 2 },
    { id: 'volatility',     decimals: 1 },
    { id: 'risk-free-rate', decimals: 1 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

function sliderVal(id) { return parseFloat($(`${id}-slider`).value) || 0; }
function numVal(id)    { return parseFloat($(id).value) || 0; }

function getEnv() {
    return {
        F:      sliderVal('futures-price'),
        r:      sliderVal('risk-free-rate') / 100,
        sigma:  sliderVal('volatility') / 100,
        T:      sliderVal('time-to-expiry'),
        spotMin: numVal('spot-min'),
        spotMax: numVal('spot-max'),
    };
}

function formatVal(v) {
    if (typeof v !== 'number' || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return v.toLocaleString('en', { maximumFractionDigits: 1 });
    if (a >= 0.01) return v.toFixed(4);
    return v.toExponential(2);
}

function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function setSlider(id, value) {
    const slider = $(`${id}-slider`);
    const input = $(`${id}-input`);
    const dec = SLIDERS.find(s => s.id === id)?.decimals ?? 1;
    if (value > parseFloat(slider.max)) slider.max = value * 1.5;
    if (value < parseFloat(slider.min) && value >= 0) slider.min = value;
    slider.value = value;
    input.value = parseFloat(value).toFixed(dec);
}

// ─── Initialization ──────────────────────────────────────────────────────────

function init() {
    // Header clock
    updateClock();
    setInterval(updateClock, 1000);

    // Populate strategy dropdown
    const strat = $('strategy-select');
    for (const name of Object.keys(STRATEGIES)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        strat.appendChild(opt);
    }
    strat.value = 'Strangle';

    // Wire sliders ↔ inputs (bidirectional)
    for (const s of SLIDERS) {
        const slider = $(`${s.id}-slider`);
        const input = $(`${s.id}-input`);
        if (!slider || !input) continue;

        slider.addEventListener('input', () => {
            input.value = parseFloat(slider.value).toFixed(s.decimals);
            if (s.id === 'futures-price') onFuturesChange();
            debouncedUpdate();
        });
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (!isNaN(v)) {
                if (v > parseFloat(slider.max)) slider.max = v * 1.5;
                if (v < parseFloat(slider.min) && v >= 0) slider.min = v;
                slider.value = v;
                if (s.id === 'futures-price') onFuturesChange();
                debouncedUpdate();
            }
        });
    }

    for (const id of ['spot-min', 'spot-max']) {
        const el = $(id);
        if (el) el.addEventListener('input', debouncedUpdate);
    }

    // Init charts
    Plotly.newPlot('payoff-chart', [], { ...CHART_LAYOUT }, CHART_CONFIG);
    Plotly.newPlot('greeks-chart', [], { ...CHART_LAYOUT }, CHART_CONFIG);
    Plotly.newPlot('theta-chart', [], { ...CHART_LAYOUT }, CHART_CONFIG);
    const ic = getChartColors();
    const initSceneAxis = (title) => ({ title, backgroundcolor: ic.bg, gridcolor: ic.grid, color: ic.muted, showbackground: true });
    Plotly.newPlot('surface-chart', [], {
        paper_bgcolor: ic.bg, plot_bgcolor: ic.bg,
        font: { color: ic.text, family: 'JetBrains Mono, monospace', size: 11 },
        scene: {
            xaxis: initSceneAxis('Spot'),
            yaxis: initSceneAxis('Volatility'),
            zaxis: initSceneAxis('Delta'),
            bgcolor: ic.bg,
        },
        margin: { l: 0, r: 0, t: 10, b: 0 },
    }, CHART_CONFIG);

    window.addEventListener('resize', debounce(() => {
        ['payoff-chart', 'greeks-chart', 'surface-chart', 'theta-chart', 'risk-mc-chart']
            .forEach(id => { try { Plotly.Plots.resize(id); } catch (e) {} });
    }, 150));

    onFuturesChange();
    renderLegs();
    updateCharts();
    runRiskAnalysis();
}

const debouncedUpdate = debounce(() => updateCharts(), 80);

function updateClock() {
    const el = $('header-clock');
    if (!el) return;
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    el.textContent = `Updated ${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

// ─── Futures price display + strike default ──────────────────────────────────

let _lastAutoStrike = null;

function onFuturesChange() {
    const F = sliderVal('futures-price');

    // Keep the plot window wide enough for F and every strike
    autoFitWindow();

    // Update new-strike default unless the user customised it
    const strikeEl = $('new-strike');
    if (strikeEl) {
        const cur = parseFloat(strikeEl.value);
        if (_lastAutoStrike == null || Math.abs(cur - _lastAutoStrike) < 1e-6) {
            strikeEl.value = F.toFixed(2);
            _lastAutoStrike = parseFloat(strikeEl.value);
        }
    }
}

// Expand the SPOT MIN/MAX window so F and every portfolio strike stay visible
// (with margin). Only refits when the current window doesn't comfortably
// contain them, so manual zoom is preserved otherwise.
function autoFitWindow() {
    const F = sliderVal('futures-price');
    const pts = [F, ...portfolio.map(l => l.strike)].filter(v => isFinite(v) && v > 0);
    if (pts.length === 0) return;
    const lo = Math.min(...pts), hi = Math.max(...pts);

    const sMin = numVal('spot-min'), sMax = numVal('spot-max');
    const margin = isFinite(sMin) && isFinite(sMax) && sMax > sMin ? (sMax - sMin) * 0.04 : Infinity;
    const contained = isFinite(sMin) && isFinite(sMax) && sMin < sMax
        && lo >= sMin + margin && hi <= sMax - margin;
    if (contained) return;

    const pad = Math.max((hi - lo) * 0.5, F * 0.25, 1);
    $('spot-min').value = +Math.max(0, lo - pad).toFixed(2);
    $('spot-max').value = +(hi + pad).toFixed(2);
}

function resetEnv() {
    setSlider('futures-price', 270.20);
    setSlider('time-to-expiry', 0.5);
    setSlider('volatility', 34);
    setSlider('risk-free-rate', 5);
    $('spot-min').value = 135;
    $('spot-max').value = 405;
    _lastAutoStrike = null;
    onFuturesChange();
    updateCharts();
    runRiskAnalysis();
}

// ─── Portfolio Management ────────────────────────────────────────────────────

function addLeg() {
    portfolio.push({
        type: $('new-type').value,
        position: $('new-position').value,
        strike: parseFloat($('new-strike').value) || 100,
        quantity: parseInt($('new-qty').value) || 1,
    });
    autoFitWindow();
    renderLegs();
    updateCharts();
}

function removeLeg(idx) {
    portfolio.splice(idx, 1);
    autoFitWindow();
    renderLegs();
    updateCharts();
}

function updateLegStrike(idx, value) {
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0) { portfolio[idx].strike = v; autoFitWindow(); updateCharts(); }
}

function clearLegs() {
    portfolio = [];
    renderLegs();
    updateCharts();
}

// ─── Strategy staging (configure strikes before pushing to the book) ──────────

let staging = [];

function buildStrategy() {
    const name = $('strategy-select').value;
    const F = sliderVal('futures-price');
    if (!STRATEGIES[name]) return;
    staging = STRATEGIES[name](F);
    renderStaging();
}

function updateStagingField(idx, field, value) {
    const leg = staging[idx];
    if (!leg) return;
    if (field === 'strike') {
        const v = parseFloat(value);
        if (!isNaN(v) && v > 0) leg.strike = v;
    } else if (field === 'quantity') {
        const v = parseInt(value);
        if (!isNaN(v) && v > 0) leg.quantity = v;
    } else {
        leg[field] = value;
    }
}

function removeStaging(idx) {
    staging.splice(idx, 1);
    renderStaging();
}

function renderStaging() {
    const c = $('staging-container');
    const pushBtn = $('staging-push');
    if (!c) return;

    if (staging.length === 0) {
        c.innerHTML = '';
        if (pushBtn) pushBtn.style.display = 'none';
        return;
    }
    if (pushBtn) pushBtn.style.display = '';

    c.innerHTML = staging.map((leg, i) => `
        <div class="stage-row">
            <div class="stage-line">
                <select onchange="updateStagingField(${i},'position',this.value)">
                    <option value="long" ${leg.position === 'long' ? 'selected' : ''}>LONG</option>
                    <option value="short" ${leg.position === 'short' ? 'selected' : ''}>SHORT</option>
                </select>
                <select onchange="updateStagingField(${i},'type',this.value)">
                    <option value="call" ${leg.type === 'call' ? 'selected' : ''}>CALL</option>
                    <option value="put" ${leg.type === 'put' ? 'selected' : ''}>PUT</option>
                </select>
                <button class="stage-rm" onclick="removeStaging(${i})">&times;</button>
            </div>
            <div class="stage-line mt-6">
                <span class="stage-tag">K</span>
                <input type="number" class="stage-k" value="${leg.strike}" step="0.5"
                    oninput="updateStagingField(${i},'strike',this.value)">
                <span class="stage-tag">QTY</span>
                <input type="number" class="stage-q" value="${leg.quantity}" min="1" step="1"
                    oninput="updateStagingField(${i},'quantity',this.value)">
            </div>
        </div>`).join('');
}

function pushStagingToPortfolio() {
    if (staging.length === 0) return;
    for (const leg of staging) {
        portfolio.push({ type: leg.type, position: leg.position, strike: leg.strike, quantity: leg.quantity });
    }
    staging = [];
    autoFitWindow();
    renderStaging();
    renderLegs();
    updateCharts();
}

function renderLegs() {
    const container = $('legs-container');
    if (container) container.innerHTML = '';  // legacy hidden container
}

function updateLegIv(idx, value) {
    const leg = portfolio[idx];
    if (!leg) return;
    const raw = (value ?? '').toString().trim();
    if (raw === '') {
        delete leg.iv;
    } else {
        const pct = parseFloat(raw);
        if (!isNaN(pct) && pct > 0) leg.iv = pct / 100;
    }
    updateCharts();
}

// ─── Greeks quick buttons ─────────────────────────────────────────────────────

function quickGreek(name) {
    activeMetrics = [name];
    updateQuickGreekBtns();
    updateCharts();
}

function updateQuickGreekBtns() {
    document.querySelectorAll('.greek-qbtn').forEach(btn => {
        const g = btn.textContent.toLowerCase();
        btn.classList.toggle('active', activeMetrics.includes(g));
    });
    const sub = $('greeks-subtitle');
    if (sub) sub.textContent = activeMetrics.map(m => m.toUpperCase()).join(' / ');
}

// ─── Chart Updates ───────────────────────────────────────────────────────────

function legLabel(leg) {
    const sign = leg.position === 'long' ? '+' : '-';
    const type = leg.type === 'call' ? 'CALL' : 'PUT';
    return `${sign}${leg.quantity} ${type} K=${leg.strike}`;
}

function updateCharts() {
    CHART_LAYOUT = getChartLayout();
    const cc = getChartColors();
    const env = getEnv();
    if (env.spotMin >= env.spotMax || env.spotMin < 0) return;

    updateGreeksByLeg();

    const spotRange = linspace(env.spotMin, env.spotMax, 220);

    // Empty state
    if (portfolio.length === 0) {
        const emptyLayout = (yTitle) => ({
            ...CHART_LAYOUT,
            xaxis: { ...CHART_LAYOUT.xaxis, title: `Underlying (${UNIT})`, range: [env.spotMin, env.spotMax] },
            yaxis: { ...CHART_LAYOUT.yaxis, title: yTitle },
            shapes: [{ type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper', line: { color: cc.muted, width: 1, dash: 'dot' } }],
            annotations: [{ text: 'Add positions to begin analysis', xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { size: 13, color: cc.muted } }],
        });
        const zeroLine = { x: spotRange, y: spotRange.map(() => 0), type: 'scatter', mode: 'lines', line: { color: cc.zeroLine, width: 1 }, showlegend: false, hoverinfo: 'skip' };
        Plotly.react('payoff-chart', [zeroLine], emptyLayout('P&L'), CHART_CONFIG);
        Plotly.react('greeks-chart', [zeroLine], emptyLayout('Greeks'), CHART_CONFIG);
        Plotly.react('theta-chart', [zeroLine], emptyLayout('Portfolio Value'), CHART_CONFIG);
        return;
    }

    // Update headline metric values
    const current = portfolioGreeks(portfolio, env.F, env.r, env.sigma, env.T);
    current.payoff = portfolioPayoff(portfolio, [env.F])[0];
    for (const name of ALL_METRICS) {
        const el = $(`mval-${name}`);
        if (el) el.textContent = formatVal(current[name]);
    }
    updateQuickGreekBtns();

    renderPayoff(env, spotRange, cc);
    renderGreeks(env, spotRange, cc);
    renderThetaDecay(env, cc);
    generateSurface();
}

// ─── Payoff diagram ──────────────────────────────────────────────────────────

function renderPayoff(env, spotRange, cc) {
    const netPremium = portfolioValue(portfolio, env.F, env.r, env.sigma, env.T);
    const payoffIntrinsic = portfolioPayoff(portfolio, spotRange);
    const expiryPnl = payoffIntrinsic.map(v => v - netPremium);
    const mtmPnl = spotRange.map(S => portfolioValue(portfolio, S, env.r, env.sigma, env.T) - netPremium);

    const traces = [];

    // P&L at expiry (solid teal, filled)
    traces.push({
        x: spotRange, y: expiryPnl, name: 'P&L at Expiry',
        type: 'scatter', mode: 'lines',
        line: { color: LINE_COLORS[0], width: 2.5 },
        fill: 'tozeroy', fillcolor: 'rgba(45,212,191,0.08)',
    });

    // MTM P&L (same IV/DTE) (dashed amber)
    traces.push({
        x: spotRange, y: mtmPnl, name: 'MTM P&L (same IV/DTE)',
        type: 'scatter', mode: 'lines',
        line: { color: LINE_COLORS[1], width: 1.5, dash: 'dot' },
    });

    // Per-leg expiry payoff lines (dashed, muted)
    portfolio.forEach((leg, i) => {
        traces.push({
            x: spotRange, y: spotRange.map(S => legPayoff(leg, S)),
            name: legLabel(leg), type: 'scatter', mode: 'lines',
            line: { color: LEG_COLORS[i % LEG_COLORS.length], width: 1, dash: 'dash' },
        });
    });

    const strikes = [...new Set(portfolio.map(l => l.strike))].sort((a, b) => a - b);
    const shapes = [{ type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper', line: { color: cc.muted, width: 1, dash: 'dot' } }];
    for (const k of strikes) shapes.push({ type: 'line', x0: k, x1: k, y0: 0, y1: 1, yref: 'paper', line: { color: cc.grid, width: 1, dash: 'dash' } });

    Plotly.react('payoff-chart', traces, {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: { text: `Underlying (${UNIT})`, standoff: 12 } },
        yaxis: { ...CHART_LAYOUT.yaxis, title: { text: 'P&L', font: { size: 11, color: cc.muted } } },
        shapes,
        showlegend: true,
        annotations: [{
            x: env.F, y: 1, xref: 'x', yref: 'paper', text: `F = ${env.F.toFixed(2)}`,
            showarrow: false, font: { size: 9, color: cc.muted, family: 'JetBrains Mono, monospace' },
            yanchor: 'bottom', bgcolor: 'rgba(11,16,23,0.85)', borderpad: 2,
        }],
    }, CHART_CONFIG);
}

// ─── Greeks analytics ────────────────────────────────────────────────────────

function renderGreeks(env, spotRange, cc) {
    const metric = activeMetrics[0] || 'delta';
    const traces = [];

    // Total (solid teal)
    traces.push({
        x: spotRange,
        y: spotRange.map(S => portfolioGreeks(portfolio, S, env.r, env.sigma, env.T)[metric] || 0),
        name: metric.charAt(0).toUpperCase() + metric.slice(1),
        type: 'scatter', mode: 'lines',
        line: { color: LINE_COLORS[0], width: 2.5 },
    });

    // Per-leg dashed lines
    portfolio.forEach((leg, i) => {
        traces.push({
            x: spotRange,
            y: spotRange.map(S => computeGreeks(leg, S, env.r, env.sigma, env.T)[metric] || 0),
            name: legLabel(leg), type: 'scatter', mode: 'lines',
            line: { color: LEG_COLORS[i % LEG_COLORS.length], width: 1, dash: 'dash' },
        });
    });

    Plotly.react('greeks-chart', traces, {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: { text: `Underlying (${UNIT})`, standoff: 12 } },
        yaxis: { ...CHART_LAYOUT.yaxis, title: { text: metric.toUpperCase(), font: { size: 11, color: LINE_COLORS[0] } } },
        shapes: [{ type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper', line: { color: cc.muted, width: 1, dash: 'dot' } }],
        showlegend: true,
    }, CHART_CONFIG);
}

// ─── Theta decay (portfolio value vs days to expiry) ─────────────────────────

function renderThetaDecay(env, cc) {
    const nSteps = 80;
    const daysTotal = Math.max(env.T * 365, 2);
    const dayGrid = linspace(daysTotal, 0.5, nSteps);   // days to expiry, descending

    const levels = [
        { lab: `At F=${env.F.toFixed(0)}`,            f: env.F,        color: LINE_COLORS[0], w: 2.5, dash: 'solid' },
        { lab: `At F=${(env.F * 0.9).toFixed(0)} (-10%)`, f: env.F * 0.9, color: LINE_COLORS[2], w: 1.5, dash: 'dash' },
        { lab: `At F=${(env.F * 1.1).toFixed(0)} (+10%)`, f: env.F * 1.1, color: LINE_COLORS[1], w: 1.5, dash: 'dash' },
    ];

    const traces = levels.map(lv => ({
        x: dayGrid,
        y: dayGrid.map(d => portfolioValue(portfolio, lv.f, env.r, env.sigma, d / 365)),
        name: lv.lab, type: 'scatter', mode: 'lines',
        line: { color: lv.color, width: lv.w, dash: lv.dash },
    }));

    Plotly.react('theta-chart', traces, {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: { text: 'Days to Expiry', standoff: 12 }, autorange: 'reversed' },
        yaxis: { ...CHART_LAYOUT.yaxis, title: { text: 'Portfolio Value', font: { size: 11, color: cc.muted } } },
        showlegend: true,
        hovermode: 'x unified',
    }, CHART_CONFIG);
}

// ─── 3D Surface ──────────────────────────────────────────────────────────────

function generateSurface() {
    if (portfolio.length === 0) return;
    const env = getEnv();
    const greek = $('surface-greek').value;
    const axis = $('surface-axis').value;

    const nSpot = 40, nSecond = 25;
    const spotRange = linspace(env.spotMin, env.spotMax, nSpot);

    let secondRange, axisTitle;
    if (axis === 'time_to_expiry') {
        secondRange = linspace(0.02, Math.max(env.T * 2, 0.5), nSecond);
        axisTitle = 'Time to Maturity (T)';
    } else {
        secondRange = linspace(Math.max(env.sigma * 0.2, 0.05), env.sigma * 2.5, nSecond);
        axisTitle = 'Volatility (σ)';
    }

    const surface = computeGreekSurface(portfolio, greek, spotRange, secondRange, axis, env);
    const cc = getChartColors();

    const trace = {
        type: 'surface', x: spotRange, y: secondRange, z: surface,
        colorscale: 'Viridis', opacity: 0.92,
        contours: { z: { show: true, usecolormap: true, highlightcolor: cc.surfaceHighlight, project: { z: true } } },
        colorbar: { title: { text: greek.toUpperCase(), font: { size: 11, color: cc.muted } }, tickfont: { size: 10, color: cc.muted }, len: 0.6 },
    };

    const sub = $('surface-subtitle');
    if (sub) sub.textContent = greek.toUpperCase();

    const sceneAxis = (title) => ({ title, backgroundcolor: cc.bg, gridcolor: cc.grid, color: cc.muted, showbackground: true });
    Plotly.react('surface-chart', [trace], {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'JetBrains Mono, monospace', size: 11 },
        scene: { xaxis: sceneAxis('Spot'), yaxis: sceneAxis(axisTitle), zaxis: sceneAxis(greek.toUpperCase()), bgcolor: cc.bg },
        margin: { l: 0, r: 0, t: 10, b: 0 },
    }, CHART_CONFIG);
}

// ─── Portfolio leg tags + Greeks-by-Leg table ─────────────────────────────────

function updateGreeksByLeg() {
    const tagsEl = $('portfolio-leg-tags');
    const tableEl = $('greeks-by-leg-table');
    if (!tagsEl || !tableEl) return;

    $('leg-count').textContent = portfolio.length;

    if (portfolio.length === 0) {
        tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:10px">No positions</span>';
        tableEl.innerHTML = '';
        return;
    }

    const env = getEnv();
    const globalVolPct = sliderVal('volatility');

    tagsEl.innerHTML = portfolio.map((leg, i) => {
        const sign = leg.position === 'long' ? '+' : '-';
        const type = leg.type === 'call' ? 'CALL' : 'PUT';
        const g = computeGreeks(leg, env.F, env.r, env.sigma, env.T);
        const price = Math.abs(g.price || 0);
        const hasIv = typeof leg.iv === 'number' && isFinite(leg.iv) && leg.iv > 0;
        const ivVal = hasIv ? (leg.iv * 100).toFixed(1) : '';
        return `<span class="leg-tag">${sign}${leg.quantity} ${type} K=${leg.strike}
            <span class="tag-price">${price.toFixed(2)}</span>
            <span class="tag-iv" title="IV override (blank = portfolio σ)">σ=<input type="number"
                class="tag-iv-input${hasIv ? ' override' : ''}" value="${ivVal}" placeholder="${globalVolPct.toFixed(1)}"
                min="0" step="0.5" onchange="updateLegIv(${i}, this.value)"
                oninput="updateLegIv(${i}, this.value)">%</span>
            <span class="tag-close" onclick="removeLeg(${i})">&times;</span></span>`;
    }).join('');

    const cols = ['Leg', 'Value', 'Delta', 'Gamma', 'Vega', 'Theta/d', 'Rho'];
    let rows = '';
    const totals = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };

    for (const leg of portfolio) {
        const g = computeGreeks(leg, env.F, env.r, env.sigma, env.T);
        const sign = leg.position === 'long' ? '+' : '-';
        const type = leg.type === 'call' ? 'CALL' : 'PUT';
        const label = `${sign}${leg.quantity} ${type} K=${leg.strike}`;
        const style = leg.position === 'short' ? ' style="color:#f87171"' : ' style="color:#2dd4bf"';

        totals.price += g.price || 0; totals.delta += g.delta || 0; totals.gamma += g.gamma || 0;
        totals.vega += g.vega || 0;  totals.theta += g.theta || 0; totals.rho += g.rho || 0;

        rows += `<tr>
            <td${style}>${label}</td>
            <td>${fmtG(g.price)}</td><td>${fmtG(g.delta, 4)}</td><td>${fmtG(g.gamma, 6)}</td>
            <td>${fmtG(g.vega, 4)}</td><td>${fmtG(g.theta, 4)}</td><td>${fmtG(g.rho, 4)}</td>
        </tr>`;
    }
    rows += `<tr class="row-total">
        <td>TOTAL</td>
        <td>${fmtG(totals.price)}</td><td>${fmtG(totals.delta, 4)}</td><td>${fmtG(totals.gamma, 6)}</td>
        <td>${fmtG(totals.vega, 4)}</td><td>${fmtG(totals.theta, 4)}</td><td>${fmtG(totals.rho, 4)}</td>
    </tr>`;

    tableEl.innerHTML = `<table class="greeks-leg-table">
        <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table>`;
}

function fmtG(v, dec = 2) {
    if (typeof v !== 'number' || isNaN(v)) return '—';
    return v.toFixed(dec);
}

// ─── Risk Management ─────────────────────────────────────────────────────────

function runRiskAnalysis() {
    if (portfolio.length === 0) return;
    const env = getEnv();
    const conf = parseFloat($('risk-confidence')?.value || 0.99);
    const horizon = parseInt($('risk-horizon')?.value || 10);
    const nSims = parseInt($('risk-mc-sims')?.value || 10000);

    const sigma = env.sigma, F = env.F;
    const dt = horizon / 252, sqrtDt = Math.sqrt(dt);
    const curVal = portfolioValue(portfolio, F, env.r, sigma, env.T);

    // Monte Carlo
    const pnls = [];
    for (let i = 0; i < nSims; i++) {
        const z = randomNormal();
        const Fnew = F * Math.exp(-0.5 * sigma * sigma * dt + sigma * sqrtDt * z);
        const Tnew = Math.max(env.T - dt, 0.001);
        pnls.push(portfolioValue(portfolio, Fnew, env.r, sigma, Tnew) - curVal);
    }
    pnls.sort((a, b) => a - b);

    const mcVarIdx = Math.floor(nSims * (1 - conf));
    const mcVar1d = -pnls[Math.floor(nSims * (1 - conf) * (1 / horizon))] || 0;
    const mcVarHorizon = -pnls[mcVarIdx] || 0;
    const tailPnls = pnls.slice(0, mcVarIdx + 1);
    const mcES = tailPnls.length > 0 ? -(tailPnls.reduce((a, b) => a + b, 0) / tailPnls.length) : 0;

    // Parametric (delta-gamma)
    const greeks = portfolioGreeks(portfolio, F, env.r, sigma, env.T);
    const zConf = conf === 0.99 ? 2.326 : 1.645;
    const dollarDelta = (greeks.delta || 0) * F;
    const dollarGamma = 0.5 * (greeks.gamma || 0) * F * F;
    const paramVar1d = Math.abs(dollarDelta * sigma * Math.sqrt(1 / 252) * zConf + dollarGamma * (sigma * Math.sqrt(1 / 252) * zConf) ** 2);
    const paramVarH = paramVar1d * Math.sqrt(horizon);

    // Historical (MC proxy for daily shocks)
    const dailyPnls = [];
    const dt1d = 1 / 252, sqrt1d = Math.sqrt(dt1d);
    for (let i = 0; i < 500; i++) {
        const z = randomNormal();
        const Fd = F * Math.exp(-0.5 * sigma * sigma * dt1d + sigma * sqrt1d * z);
        const Td = Math.max(env.T - dt1d, 0.001);
        dailyPnls.push(portfolioValue(portfolio, Fd, env.r, sigma, Td) - curVal);
    }
    dailyPnls.sort((a, b) => a - b);
    const histVar1d = -dailyPnls[Math.floor(500 * (1 - conf))] || 0;
    const histVarH = histVar1d * Math.sqrt(horizon);
    const histTail = dailyPnls.slice(0, Math.floor(500 * (1 - conf)) + 1);
    const histES = histTail.length > 0 ? -(histTail.reduce((a, b) => a + b, 0) / histTail.length) : 0;

    // Maximum drawdown from MC paths
    const ddSamples = [];
    for (let i = 0; i < Math.min(nSims, 2000); i++) {
        let peak = curVal, maxDD = 0, val = curVal;
        for (let d = 1; d <= horizon; d++) {
            const z = randomNormal();
            const Fd = F * Math.exp(-0.5 * sigma * sigma * (d / 252) + sigma * Math.sqrt(d / 252) * z);
            val = portfolioValue(portfolio, Fd, env.r, sigma, Math.max(env.T - d / 252, 0.001));
            if (val > peak) peak = val;
            if (peak - val > maxDD) maxDD = peak - val;
        }
        ddSamples.push(maxDD);
    }
    ddSamples.sort((a, b) => a - b);
    const avgDD = ddSamples.reduce((a, b) => a + b, 0) / ddSamples.length;
    const dd95 = ddSamples[Math.floor(ddSamples.length * 0.95)] || 0;
    const worstDD = ddSamples[ddSamples.length - 1] || 0;

    renderVarTable(conf, horizon, histVar1d, histVarH, paramVar1d, paramVarH, mcVar1d, mcVarHorizon);
    renderCvarTable(conf, histES, mcES);
    renderDrawdownTable(avgDD, dd95, worstDD);
    renderMcChart(pnls, mcVarHorizon, conf);
    renderStressTests(env, curVal);
}

function randomNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function renderVarTable(conf, horizon, hVar1d, hVarH, pVar1d, pVarH, mcVar1d, mcVarH) {
    const confPct = (conf * 100).toFixed(0);
    const el = $('risk-var-table');
    if (!el) return;
    el.innerHTML = `<table class="risk-table">
        <thead><tr><th style="text-align:left">VALUE-AT-RISK</th><th>VaR 1d (${confPct}%)</th><th>VaR ${horizon}d (${confPct}%)</th></tr></thead>
        <tbody>
            <tr><td>Historical</td><td class="val-neg">${hVar1d.toFixed(2)}</td><td class="val-neg">${hVarH.toFixed(2)}</td></tr>
            <tr><td>Parametric (&Delta;-&Gamma;)</td><td class="val-neg">${pVar1d.toFixed(2)}</td><td class="val-neg">${pVarH.toFixed(2)}</td></tr>
            <tr><td>Monte Carlo</td><td class="val-neg">${mcVar1d.toFixed(2)}</td><td class="val-neg">${mcVarH.toFixed(2)}</td></tr>
        </tbody></table>`;
}

function renderCvarTable(conf, histES, mcES) {
    const confPct = (conf * 100).toFixed(0);
    const el = $('risk-cvar-table');
    if (!el) return;
    el.innerHTML = `<table class="risk-table">
        <thead><tr><th colspan="2" style="text-align:left">CVaR / EXPECTED SHORTFALL (${confPct}%)</th></tr></thead>
        <tbody>
            <tr><td>Historical ES</td><td class="val-neg">${histES.toFixed(2)}</td></tr>
            <tr><td>Monte Carlo ES</td><td class="val-neg">${mcES.toFixed(2)}</td></tr>
        </tbody></table>`;
}

function renderDrawdownTable(avg, p95, worst) {
    const el = $('risk-drawdown-table');
    if (!el) return;
    const horizon = parseInt($('risk-horizon')?.value || 10);
    el.innerHTML = `<table class="risk-table">
        <thead><tr><th colspan="2" style="text-align:left">MAXIMUM DRAWDOWN (${horizon}D, MC)</th></tr></thead>
        <tbody>
            <tr><td>Avg Drawdown</td><td class="val-neg">${avg.toFixed(2)}</td></tr>
            <tr><td>95th pctl DD</td><td class="val-neg">${p95.toFixed(2)}</td></tr>
            <tr><td>Worst-case DD</td><td class="val-neg">${worst.toFixed(2)}</td></tr>
        </tbody></table>`;
}

function renderMcChart(pnls, varLine, conf) {
    const cc = getChartColors();
    const lo = pnls[0], hi = pnls[pnls.length - 1];
    const binSize = (hi - lo) / 80 || 1;
    const xbins = { start: lo, end: hi, size: binSize };

    const gains = pnls.filter(p => p >= -varLine);
    const tail = pnls.filter(p => p < -varLine);

    const traces = [
        { x: tail, type: 'histogram', name: 'Tail', xbins, marker: { color: cc.accent2 } },
        { x: gains, type: 'histogram', name: 'P&L', xbins, marker: { color: cc.accent } },
    ];

    Plotly.react('risk-mc-chart', traces, {
        ...getChartLayout(),
        barmode: 'overlay', bargap: 0.02,
        xaxis: { ...getChartLayout().xaxis, title: 'P&L' },
        yaxis: { ...getChartLayout().yaxis, title: 'Frequency' },
        margin: { l: 50, r: 20, t: 20, b: 40 },
        showlegend: false,
        shapes: [{ type: 'line', x0: -varLine, x1: -varLine, y0: 0, y1: 1, yref: 'paper', line: { color: cc.accent2, width: 2, dash: 'dash' } }],
        annotations: [{ x: -varLine, y: 1, yref: 'paper', text: `VaR ${(conf * 100).toFixed(0)}%`, showarrow: true, arrowhead: 2, ax: 30, ay: -20, font: { size: 10, color: cc.accent2 } }],
    }, CHART_CONFIG);
}

function renderStressTests(env, curVal) {
    const el = $('risk-stress-table');
    if (!el) return;

    const scenarios = [
        { name: 'Crash -20%',     dPrice: -0.20, dVol: 0.50 },
        { name: 'Sell-off -10%',  dPrice: -0.10, dVol: 0.25 },
        { name: 'Dip -5%',        dPrice: -0.05, dVol: 0.10 },
        { name: 'Rally +5%',      dPrice: 0.05,  dVol: -0.05 },
        { name: 'Rally +10%',     dPrice: 0.10,  dVol: -0.10 },
        { name: 'Rally +20%',     dPrice: 0.20,  dVol: -0.15 },
        { name: 'Vol Spike +50%', dPrice: 0,     dVol: 0.50 },
        { name: 'Vol Crush -50%', dPrice: 0,     dVol: -0.50 },
        { name: 'Frost Event',    dPrice: 0.30,  dVol: 0.80 },
        { name: '1 Week Decay',   dPrice: 0,     dVol: 0,    dT: 5 / 252 },
        { name: '1 Month Decay',  dPrice: 0,     dVol: 0,    dT: 21 / 252 },
        { name: 'Brazil Crisis',  dPrice: 0.15,  dVol: 0.40 },
    ];

    let rows = '';
    for (const s of scenarios) {
        const Fnew = env.F * (1 + s.dPrice);
        const sigNew = env.sigma * (1 + s.dVol);
        const Tnew = Math.max(env.T - (s.dT || 0), 0.001);
        const newVal = portfolioValue(portfolio, Fnew, env.r, sigNew, Tnew);
        const pnl = newVal - curVal;
        const pnlPct = curVal !== 0 ? (pnl / Math.abs(curVal) * 100) : 0;
        const priceLbl = s.dPrice ? `${(s.dPrice * 100).toFixed(0)}%` : '—';
        const volLbl = s.dVol ? `${(s.dVol * 100).toFixed(0)}%` : '—';
        const cls = pnl >= 0 ? 'val-pos' : 'val-neg';
        rows += `<tr>
            <td>${s.name}</td><td>${priceLbl}</td><td>${volLbl}</td>
            <td>${newVal.toFixed(2)}</td>
            <td class="${cls}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</td>
            <td class="${cls}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</td>
        </tr>`;
    }

    el.innerHTML = `<table class="risk-table">
        <thead><tr><th style="text-align:left">STRESS TESTS</th><th>Price &Delta;</th><th>Vol &Delta;</th><th>New Value</th><th>P&L</th><th>P&L %</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
