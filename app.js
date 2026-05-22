/**
 * Application controller — events, UI, formula rendering
 * Features: click-to-hold, ALL values editable (pinned only),
 *           °C/°F toggle, line visibility toggles, chart labels toggle
 */
document.addEventListener('DOMContentLoaded', () => {
    /* ---- DOM refs ---- */
    const staticCanvas  = document.getElementById('static-canvas');
    const dynamicCanvas = document.getElementById('dynamic-canvas');
    const themeBtn      = document.getElementById('theme-toggle');
    const tutorialOverlay = document.getElementById('tutorial-overlay');
    const tutorialClose   = document.getElementById('tutorial-close');
    const helpBtn         = document.getElementById('help-btn');

    const unitCBtn        = document.getElementById('unit-c-btn');
    const unitFBtn        = document.getElementById('unit-f-btn');
    const pinBadge        = document.getElementById('pin-badge');
    const labelsToggle    = document.getElementById('toggle-labels');

    // ALL inputs (every value is editable when pinned)
    const inputs = {
        tdb: document.getElementById('val-tdb'),
        rh:  document.getElementById('val-rh'),
        twb: document.getElementById('val-twb'),
        tdp: document.getElementById('val-tdp'),
        w:   document.getElementById('val-w'),
        h:   document.getElementById('val-h'),
        v:   document.getElementById('val-v'),
        pw:  document.getElementById('val-pw'),
    };
    const allInputs = Object.values(inputs);
    const allStepBtns = document.querySelectorAll('.step-btn');

    // Unit labels
    const unitTdb = document.getElementById('unit-tdb');
    const unitTwb = document.getElementById('unit-twb');
    const unitTdp = document.getElementById('unit-tdp');

    /* ---- State ---- */
    let pinnedPoint = null;   // { tdb, w } in °C/SI or null
    let lastProps = null;
    let animFrame = null;
    let useFahrenheit = false;
    let showLabels = true;

    // Line visibility
    const lineVisible = { rh: true, twb: true, enth: true, vol: true };

    /* ---- Unit conversion helpers ---- */
    function toF(c) { return c * 9 / 5 + 32; }
    function toC(f) { return (f - 32) * 5 / 9; }
    function displayTemp(cVal) { return useFahrenheit ? toF(cVal) : cVal; }
    function fromDisplayTemp(dVal) { return useFahrenheit ? toC(dVal) : dVal; }
    function tempUnit() { return useFahrenheit ? '°F' : '°C'; }

    /* ---- Initialise chart ---- */
    const chart = new PsychroChart(staticCanvas, dynamicCanvas);
    let isDark = true; // dark mode by default

    function applyTheme() {
        document.body.classList.toggle('dark', isDark);
        chart.setTheme(isDark);
        chart.drawStatic();
        themeBtn.textContent = isDark ? '☀️' : '🌙';
        themeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        if (pinnedPoint && lastProps) {
            chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
        }
    }
    applyTheme();

    themeBtn.addEventListener('click', () => { isDark = !isDark; applyTheme(); });

    /* ---- Unit toggle ---- */
    function applyUnitSystem() {
        chart.setUnitSystem(useFahrenheit ? 'IP' : 'SI');
        chart.drawStatic();
        unitTdb.textContent = tempUnit();
        unitTwb.textContent = tempUnit();
        unitTdp.textContent = tempUnit();
        unitCBtn.classList.toggle('active', !useFahrenheit);
        unitFBtn.classList.toggle('active', useFahrenheit);
        if (lastProps) {
            updateAllInputs(lastProps);
            chart.drawDynamic(lastProps.Tdb, lastProps.W, lastProps);
        }
    }

    unitCBtn.addEventListener('click', () => {
        if (!useFahrenheit) return;
        useFahrenheit = false;
        applyUnitSystem();
    });
    unitFBtn.addEventListener('click', () => {
        if (useFahrenheit) return;
        useFahrenheit = true;
        applyUnitSystem();
    });

    /* ---- Line visibility toggles ---- */
    document.querySelectorAll('.line-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.line;
            lineVisible[key] = !lineVisible[key];
            btn.classList.toggle('active', lineVisible[key]);
            chart.lineVisible = { ...lineVisible };
            chart.drawStatic();
            if (pinnedPoint && lastProps) {
                chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
            }
        });
    });

    // Sync initial visibility to chart
    chart.lineVisible = { ...lineVisible };

    /* ---- Chart labels toggle ---- */
    labelsToggle.addEventListener('click', () => {
        showLabels = !showLabels;
        labelsToggle.classList.toggle('active', showLabels);
        chart.showLabels = showLabels;
        if (pinnedPoint && lastProps) {
            chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
        }
    });
    chart.showLabels = showLabels;

    /* ---- Resize handling ---- */
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            chart.resize();
            chart.drawStatic();
            if (pinnedPoint && lastProps) {
                chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
            }
        }, 80);
    });

    /* ---- Tutorial (always show on open) ---- */
    tutorialOverlay.classList.add('visible');

    tutorialClose.addEventListener('click', () => {
        tutorialOverlay.classList.remove('visible');
    });
    helpBtn.addEventListener('click', () => tutorialOverlay.classList.add('visible'));

    /* ---- Tab switching ---- */
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const target = document.getElementById('tab-' + btn.dataset.tab);
            if (target) target.classList.add('active');
        });
    });

    /* ---- Pin / Unpin ---- */
    pinBadge.addEventListener('click', () => { unpin(); });

    function pin(tdb, w) {
        pinnedPoint = { tdb, w };
        chart.isPinned = true;
        pinBadge.classList.add('visible');
        allInputs.forEach(inp => inp.disabled = false);
        allStepBtns.forEach(btn => btn.disabled = false);
    }

    function unpin() {
        pinnedPoint = null;
        chart.isPinned = false;
        pinBadge.classList.remove('visible');
        chart.drawDynamic(null, null, null);
        clearValues();
        allInputs.forEach(inp => inp.disabled = true);
        allStepBtns.forEach(btn => btn.disabled = true);
    }

    /* ---- Mouse interaction ---- */
    dynamicCanvas.addEventListener('mousemove', (e) => {
        if (pinnedPoint) return;
        if (animFrame) return;
        animFrame = requestAnimationFrame(() => {
            const hit = chart.hitTest(e.clientX, e.clientY);
            if (hit) {
                const props = Psychro.allProps(hit.tdb, hit.w);
                lastProps = props;
                chart.drawDynamic(hit.tdb, hit.w, props);
                updateAllInputs(props);
                updateFormulas(props);
            } else {
                chart.drawDynamic(null, null, null);
                clearValues();
            }
            animFrame = null;
        });
    });

    dynamicCanvas.addEventListener('click', (e) => {
        const hit = chart.hitTest(e.clientX, e.clientY);
        if (hit) {
            const props = Psychro.allProps(hit.tdb, hit.w);
            lastProps = props;
            pin(hit.tdb, hit.w);
            chart.drawDynamic(hit.tdb, hit.w, props);
            updateAllInputs(props);
            updateFormulas(props);
        }
    });

    dynamicCanvas.addEventListener('mouseleave', () => {
        if (pinnedPoint) return;
        chart.drawDynamic(null, null, null);
        clearValues();
    });

    dynamicCanvas.style.cursor = 'crosshair';

    /* ---- Touch interaction (mobile) ---- */
    let touchStartPos = null;

    dynamicCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        touchStartPos = { x: touch.clientX, y: touch.clientY };

        // Show crosshair immediately at touch point
        if (!pinnedPoint) {
            const hit = chart.hitTest(touch.clientX, touch.clientY);
            if (hit) {
                const props = Psychro.allProps(hit.tdb, hit.w);
                lastProps = props;
                chart.drawDynamic(hit.tdb, hit.w, props);
                updateAllInputs(props);
                updateFormulas(props);
            }
        }
    }, { passive: false });

    dynamicCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        touchStartPos = null; // mark as drag, not tap
        if (pinnedPoint) return;

        const touch = e.touches[0];
        const hit = chart.hitTest(touch.clientX, touch.clientY);
        if (hit) {
            const props = Psychro.allProps(hit.tdb, hit.w);
            lastProps = props;
            chart.drawDynamic(hit.tdb, hit.w, props);
            updateAllInputs(props);
            updateFormulas(props);
        }
    }, { passive: false });

    dynamicCanvas.addEventListener('touchend', (e) => {
        if (touchStartPos) {
            // Was a tap (no drag) — pin the point
            const hit = chart.hitTest(touchStartPos.x, touchStartPos.y);
            if (hit) {
                const props = Psychro.allProps(hit.tdb, hit.w);
                lastProps = props;
                pin(hit.tdb, hit.w);
                chart.drawDynamic(hit.tdb, hit.w, props);
                updateAllInputs(props);
                updateFormulas(props);
            }
        } else {
            // Was a drag — clear on lift if not pinned
            if (!pinnedPoint) {
                chart.drawDynamic(null, null, null);
                clearValues();
            }
        }
        touchStartPos = null;
    });

    /* ---- Editable input handlers ---- */
    // Each input, when edited, recalculates the state from (Tdb + that_property).
    // We use Tdb as the anchor and solve for W from the edited property.
    let inputDebounce = null;

    function handleInputEdit(editedField) {
        clearTimeout(inputDebounce);
        inputDebounce = setTimeout(() => {
            if (!pinnedPoint) return; // safety: only edit when pinned

            const tdbDisp = parseFloat(inputs.tdb.value);
            if (isNaN(tdbDisp)) return;
            const tdbC = fromDisplayTemp(tdbDisp);

            // Clamp Tdb to chart range
            if (tdbC < chart.tdbMin || tdbC > chart.tdbMax) return;

            let w = null;

            switch (editedField) {
                case 'tdb': {
                    // Tdb changed: use current RH to recompute W
                    const rh = parseFloat(inputs.rh.value);
                    if (isNaN(rh)) return;
                    w = Psychro.humidityRatio(tdbC, Math.max(0, Math.min(100, rh)) / 100);
                    break;
                }
                case 'rh': {
                    const rh = parseFloat(inputs.rh.value);
                    if (isNaN(rh)) return;
                    w = Psychro.humidityRatio(tdbC, Math.max(0, Math.min(100, rh)) / 100);
                    break;
                }
                case 'twb': {
                    // Given Tdb and Twb, solve for W using psychrometric equation
                    const twbDisp = parseFloat(inputs.twb.value);
                    if (isNaN(twbDisp)) return;
                    const twbC = fromDisplayTemp(twbDisp);
                    const Ws_wb = Psychro.satHumidityRatio(twbC);
                    if (tdbC >= 0) {
                        w = ((2501 - 2.326 * twbC) * Ws_wb - 1.006 * (tdbC - twbC)) /
                            (2501 + 1.86 * tdbC - 4.186 * twbC);
                    } else {
                        w = ((2830 - 0.24 * twbC) * Ws_wb - 1.006 * (tdbC - twbC)) /
                            (2830 + 1.86 * tdbC - 2.1 * twbC);
                    }
                    break;
                }
                case 'tdp': {
                    // Given Tdp, compute Pw = Pws(Tdp), then W
                    const tdpDisp = parseFloat(inputs.tdp.value);
                    if (isNaN(tdpDisp)) return;
                    const tdpC = fromDisplayTemp(tdpDisp);
                    const Pw = Psychro.satPressure(tdpC);
                    w = 0.621945 * Pw / (Psychro.P_ATM - Pw);
                    break;
                }
                case 'w': {
                    // Humidity ratio in g/kg
                    const wg = parseFloat(inputs.w.value);
                    if (isNaN(wg)) return;
                    w = wg / 1000; // convert to kg/kg
                    break;
                }
                case 'h': {
                    // Enthalpy: h = 1.006*Tdb + W*(2501 + 1.86*Tdb)
                    // → W = (h - 1.006*Tdb) / (2501 + 1.86*Tdb)
                    const hVal = parseFloat(inputs.h.value);
                    if (isNaN(hVal)) return;
                    w = (hVal - 1.006 * tdbC) / (2501 + 1.86 * tdbC);
                    break;
                }
                case 'v': {
                    // Specific volume: v = 287.042*TK*(1+1.6078*W)/P
                    // → W = (v*P/(287.042*TK) - 1) / 1.6078
                    const vVal = parseFloat(inputs.v.value);
                    if (isNaN(vVal)) return;
                    const TK = tdbC + 273.15;
                    w = (vVal * Psychro.P_ATM / (287.042 * TK) - 1) / 1.6078;
                    break;
                }
                case 'pw': {
                    // Vapour pressure → W = 0.621945 * Pw / (P - Pw)
                    const pwVal = parseFloat(inputs.pw.value);
                    if (isNaN(pwVal) || pwVal >= Psychro.P_ATM) return;
                    w = 0.621945 * pwVal / (Psychro.P_ATM - pwVal);
                    break;
                }
                default:
                    return;
            }

            if (w === null || w < 0) return;
            if (!Psychro.isValid(tdbC, w)) return;

            const props = Psychro.allProps(tdbC, w);
            lastProps = props;
            pinnedPoint = { tdb: tdbC, w: w };
            chart.drawDynamic(tdbC, w, props);

            // Update all OTHER inputs (not the one being edited)
            updateAllInputs(props, editedField);
            updateFormulas(props);
        }, 150);
    }

    // Attach input listeners to every field
    Object.keys(inputs).forEach(key => {
        inputs[key].addEventListener('input', () => handleInputEdit(key));
    });

    // Stepper button handlers
    allStepBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!pinnedPoint) return;
            const field = btn.dataset.field;
            const dir = parseInt(btn.dataset.dir, 10);
            const inp = inputs[field];
            if (!inp) return;
            const cur = parseFloat(inp.value);
            if (isNaN(cur)) return;
            inp.value = (cur + dir).toString();
            handleInputEdit(field);
        });
    });

    /* ---- Value panel updates ---- */
    function updateAllInputs(p, skipField) {
        if (skipField !== 'tdb' && document.activeElement !== inputs.tdb)
            inputs.tdb.value = displayTemp(p.Tdb).toFixed(1);
        if (skipField !== 'rh' && document.activeElement !== inputs.rh)
            inputs.rh.value = (p.RH * 100).toFixed(1);
        if (skipField !== 'twb' && document.activeElement !== inputs.twb)
            inputs.twb.value = displayTemp(p.Twb).toFixed(1);
        if (skipField !== 'tdp' && document.activeElement !== inputs.tdp)
            inputs.tdp.value = displayTemp(p.Tdp).toFixed(1);
        if (skipField !== 'w' && document.activeElement !== inputs.w)
            inputs.w.value = (p.W * 1000).toFixed(2);
        if (skipField !== 'h' && document.activeElement !== inputs.h)
            inputs.h.value = p.h.toFixed(2);
        if (skipField !== 'v' && document.activeElement !== inputs.v)
            inputs.v.value = p.v.toFixed(4);
        if (skipField !== 'pw' && document.activeElement !== inputs.pw)
            inputs.pw.value = p.Pw.toFixed(1);

        // Flash animation
        document.querySelectorAll('.val-row').forEach(r => {
            r.classList.remove('flash');
            void r.offsetWidth;
            r.classList.add('flash');
        });
    }

    function clearValues() {
        allInputs.forEach(inp => {
            if (document.activeElement !== inp) inp.value = '';
        });
    }
    clearValues();

    /* ---- Formula rendering with KaTeX ---- */
    const fEls = {
        pws:  document.getElementById('f-pws'),
        pw:   document.getElementById('f-pw'),
        w:    document.getElementById('f-w'),
        rh:   document.getElementById('f-rh'),
        h:    document.getElementById('f-h'),
        v:    document.getElementById('f-v'),
        tdp:  document.getElementById('f-tdp'),
        twb:  document.getElementById('f-twb'),
    };

    function kx(el, tex) {
        if (window.katex) {
            katex.render(tex, el, { throwOnError: false, displayMode: false });
        } else {
            el.textContent = tex;
        }
    }

    function updateFormulas(p) {

        const Tdb = p.Tdb.toFixed(1);
        const TK = (p.Tdb + 273.15).toFixed(2);
        const W = p.W.toFixed(5);
        const Wg = (p.W * 1000).toFixed(2);
        const Pws = p.Pws.toFixed(1);
        const Pw = p.Pw.toFixed(1);
        const RH = (p.RH * 100).toFixed(1);
        const hv = p.h.toFixed(2);
        const vv = p.v.toFixed(4);
        const Tdp = p.Tdp.toFixed(1);
        const Twb = p.Twb.toFixed(1);
        const P = (p.P).toFixed(0);

        kx(fEls.pws,
            `P_{ws} = e^{f(T)} = ${Pws} \\text{ Pa}`);

        kx(fEls.pw,
            `P_w = \\phi \\cdot P_{ws} = ${(p.RH).toFixed(4)} \\times ${Pws} = ${Pw} \\text{ Pa}`);

        kx(fEls.w,
            `W = 0.621945\\,\\frac{P_w}{P - P_w} = 0.621945 \\times \\frac{${Pw}}{${P} - ${Pw}} = ${Wg} \\text{ g/kg}`);

        kx(fEls.rh,
            `\\phi = \\frac{P_w}{P_{ws}} = \\frac{${Pw}}{${Pws}} = ${RH}\\%`);

        kx(fEls.h,
            `h = 1.006 T_{db} + W(2501 + 1.86 T_{db}) = ${hv} \\text{ kJ/kg}`);

        kx(fEls.v,
            `v = \\frac{R_a T_K (1 + 1.608 W)}{P} = \\frac{287.04 \\times ${TK} \\times ${(1 + 1.6078 * p.W).toFixed(5)}}{${P}} = ${vv} \\text{ m}^3\\text{/kg}`);

        kx(fEls.tdp,
            `T_{dp} : P_{ws}(T_{dp}) = P_w = ${Pw} \\Rightarrow T_{dp} = ${Tdp}°\\text{C}`);

        kx(fEls.twb,
            `T_{wb} : W = \\frac{(2501 - 2.326 T_{wb})W_{s,wb} - 1.006(T_{db} - T_{wb})}{2501 + 1.86 T_{db} - 4.186 T_{wb}} \\Rightarrow ${Twb}°\\text{C}`);
    }

    // Initial KaTeX render (placeholders)
    function initFormulas() {
        kx(fEls.pws, `P_{ws} = \\exp\\!\\left(\\frac{C_8}{T_K} + C_9 + C_{10} T_K + \\cdots + C_{13} \\ln T_K\\right)`);
        kx(fEls.pw,  `P_w = \\phi \\cdot P_{ws}`);
        kx(fEls.w,   `W = 0.621945\\,\\frac{P_w}{P_{atm} - P_w}`);
        kx(fEls.rh,  `\\phi = \\frac{P_w}{P_{ws}(T_{db})}`);
        kx(fEls.h,   `h = c_{pa} T_{db} + W\\,(L_v + c_{pv} T_{db})`);
        kx(fEls.v,   `v = \\frac{R_a T_K (1 + 1.608\\,W)}{P_{atm}}`);
        kx(fEls.tdp, `T_{dp} : P_{ws}(T_{dp}) = P_w`);
        kx(fEls.twb, `T_{wb} : \\text{solve psychrometric eq. iteratively}`);
    }

    // Wait for KaTeX to load
    function waitForKaTeX(cb) {
        if (window.katex) { cb(); return; }
        const iv = setInterval(() => { if (window.katex) { clearInterval(iv); cb(); } }, 100);
    }
    waitForKaTeX(initFormulas);
});
