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

    // ---- Process Lines state ----
    const processes = [];
    let addProcessMode = false;
    let pendingPointA = null;   // { tdb, w }
    let processIdCounter = 0;
    const PROCESS_COLORS = ['#ff7c43','#ffd700','#00bcd4','#ff69b4','#a8e063','#ff6b6b'];

    // Snap state
    let snapEnabled = true;

    // Selection & move state
    const selectedSet = new Set();  // indices of selected processes
    let moveMode = false;
    let moveDragStart = null;   // { tdb, w } of mousedown
    let moveOriginals = null;   // snapshot of original points before drag

    // Process UI DOM refs
    const addProcessBtn    = document.getElementById('add-process-btn');
    const cancelProcessBtn = document.getElementById('cancel-process-btn');
    const processStatus    = document.getElementById('process-status');
    const processListEl    = document.getElementById('process-list');
    const processEmptyEl   = document.getElementById('process-empty');
    const snapToggleBtn    = document.getElementById('snap-toggle');
    const moveSelectedBtn  = document.getElementById('move-selected-btn');

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
        renderProcessList();
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

    /* ---- Snap helper for crosshair ---- */
    function applySnap(tdb, w) {
        if (!snapEnabled || processes.length === 0) return { tdb, w };
        const SNAP_PX = 15;
        const clickX = chart.tdbToX(tdb);
        const clickY = chart.wToY(w);
        let bestDist = Infinity, bestPt = null;
        for (const proc of processes) {
            for (const pt of [proc.pointA, proc.pointB]) {
                const d = Math.hypot(chart.tdbToX(pt.tdb) - clickX, chart.wToY(pt.w) - clickY);
                if (d < bestDist) { bestDist = d; bestPt = pt; }
            }
        }
        if (bestDist <= SNAP_PX && bestPt) return { tdb: bestPt.tdb, w: bestPt.w };
        return { tdb, w };
    }

    /* ---- Mouse interaction ---- */
    dynamicCanvas.addEventListener('mousemove', (e) => {
        // Handle move-mode drag
        if (moveMode && moveDragStart) {
            const hit = chart.hitTest(e.clientX, e.clientY);
            if (hit && moveOriginals) {
                const dTdb = hit.tdb - moveDragStart.tdb;
                const dW = hit.w - moveDragStart.w;
                let allValid = true;
                for (const snap of moveOriginals) {
                    if (!Psychro.isValid(snap.aTdb + dTdb, snap.aW + dW)) { allValid = false; break; }
                    if (!Psychro.isValid(snap.bTdb + dTdb, snap.bW + dW)) { allValid = false; break; }
                }
                if (allValid) {
                    moveOriginals.forEach((snap, i) => {
                        const proc = processes[snap.idx];
                        proc.pointA.tdb = snap.aTdb + dTdb;
                        proc.pointA.w = snap.aW + dW;
                        proc.pointB.tdb = snap.bTdb + dTdb;
                        proc.pointB.w = snap.bW + dW;
                    });
                    syncProcessesToChart();
                }
            }
            return;
        }

        if (pinnedPoint) return;
        if (animFrame) return;
        animFrame = requestAnimationFrame(() => {
            const hit = chart.hitTest(e.clientX, e.clientY);
            if (hit) {
                const snapped = applySnap(hit.tdb, hit.w);
                const props = Psychro.allProps(snapped.tdb, snapped.w);
                lastProps = props;
                chart.drawDynamic(snapped.tdb, snapped.w, props);
                updateAllInputs(props);
                updateFormulas(props);
            } else {
                chart.drawDynamic(null, null, null);
                clearValues();
            }
            animFrame = null;
        });
    });

    // Move mode: mousedown to start drag
    dynamicCanvas.addEventListener('mousedown', (e) => {
        if (!moveMode || selectedSet.size === 0) return;
        const hit = chart.hitTest(e.clientX, e.clientY);
        if (!hit) return;
        moveDragStart = { tdb: hit.tdb, w: hit.w };
        moveOriginals = [];
        selectedSet.forEach(idx => {
            const p = processes[idx];
            moveOriginals.push({
                idx,
                aTdb: p.pointA.tdb, aW: p.pointA.w,
                bTdb: p.pointB.tdb, bW: p.pointB.w
            });
        });
        e.preventDefault();
    });

    // Move mode: mouseup to finish drag
    dynamicCanvas.addEventListener('mouseup', (e) => {
        if (moveMode && moveDragStart) {
            moveDragStart = null;
            moveOriginals = null;
            renderProcessList();
        }
    });

    dynamicCanvas.addEventListener('click', (e) => {
        // ---- Move mode: swallow clicks ----
        if (moveMode) return;
        // ---- Add-process mode intercept ----
        if (addProcessMode) {
            handleProcessClick(e.clientX, e.clientY);
            return;
        }
        const hit = chart.hitTest(e.clientX, e.clientY);
        if (hit) {
            const snapped = applySnap(hit.tdb, hit.w);
            const props = Psychro.allProps(snapped.tdb, snapped.w);
            lastProps = props;
            pin(snapped.tdb, snapped.w);
            chart.drawDynamic(snapped.tdb, snapped.w, props);
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
            // Was a tap (no drag)
            if (addProcessMode) {
                handleProcessClick(touchStartPos.x, touchStartPos.y);
            } else {
                // Pin the point
                const hit = chart.hitTest(touchStartPos.x, touchStartPos.y);
                if (hit) {
                    const props = Psychro.allProps(hit.tdb, hit.w);
                    lastProps = props;
                    pin(hit.tdb, hit.w);
                    chart.drawDynamic(hit.tdb, hit.w, props);
                    updateAllInputs(props);
                    updateFormulas(props);
                }
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

    /* ==========================================================
       PROCESS LINES — Mode, Detection, Rendering, Events
       ========================================================== */

    /** Process type auto-detection */
    function detectProcessType(ptA, ptB) {
        const dT = ptB.tdb - ptA.tdb;
        const dW = ptB.w - ptA.w;
        const wThresh = 0.001;  // kg/kg
        const tThresh = 0.5;    // °C

        const wZero = Math.abs(dW) <= wThresh;
        const tZero = Math.abs(dT) <= tThresh;

        if (wZero && dT > tThresh)  return 'Sensible Heating';
        if (wZero && dT < -tThresh) return 'Sensible Cooling';
        if (tZero && dW > wThresh)  return 'Humidification';
        if (tZero && dW < -wThresh) return 'Dehumidification';
        if (dW < -wThresh && dT < -tThresh) return 'Cooling + Dehumidification';
        if (dW > wThresh && dT > tThresh)   return 'Heating + Humidification';
        return 'Mixed Process';
    }

    /** Sync processes array to chart and trigger redraw */
    function syncProcessesToChart() {
        chart.processes = processes;
        if (pinnedPoint && lastProps) {
            chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
        } else {
            chart.drawDynamic(null, null, null);
        }
    }

    /** Resolve an edited field for a process point back to { tdb, w } */
    function resolveProcessEdit(currentTdb, currentW, field, value) {
        let tdbC = currentTdb;
        let w = currentW;

        switch (field) {
            case 'tdb': {
                tdbC = fromDisplayTemp(value);
                // Hold RH constant when Tdb changes
                const rh = Psychro.relHumidity(currentTdb, currentW);
                w = Psychro.humidityRatio(tdbC, rh);
                break;
            }
            case 'rh': {
                const rh = Math.max(0, Math.min(100, value)) / 100;
                w = Psychro.humidityRatio(tdbC, rh);
                break;
            }
            case 'twb': {
                const twbC = fromDisplayTemp(value);
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
            case 'w': {
                w = value / 1000; // g/kg to kg/kg
                break;
            }
            case 'h': {
                // h = 1.006*Tdb + W*(2501 + 1.86*Tdb)
                w = (value - 1.006 * tdbC) / (2501 + 1.86 * tdbC);
                break;
            }
            default: return null;
        }

        if (w === null || w < 0) return null;
        if (!Psychro.isValid(tdbC, w)) return null;
        return { tdb: tdbC, w };
    }

    /** Build HTML for one point's edit grid */
    function buildPointEditHTML(idx, pointKey, point, props, color) {
        const unit = tempUnit();
        return `
            <div class="process-point-block">
                <div class="process-pt-header" style="color:${color}">${pointKey}</div>
                <div class="process-fields-grid">
                    <div class="process-field">
                        <span class="process-field-label">Tdb</span>
                        <input type="number" class="process-input" data-proc="${idx}" data-point="${pointKey}" data-field="tdb"
                               value="${displayTemp(point.tdb).toFixed(1)}" step="0.1">
                        <span class="process-field-unit">${unit}</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">RH</span>
                        <input type="number" class="process-input" data-proc="${idx}" data-point="${pointKey}" data-field="rh"
                               value="${(props.RH * 100).toFixed(1)}" step="0.5">
                        <span class="process-field-unit">%</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">Twb</span>
                        <input type="number" class="process-input" data-proc="${idx}" data-point="${pointKey}" data-field="twb"
                               value="${displayTemp(props.Twb).toFixed(1)}" step="0.1">
                        <span class="process-field-unit">${unit}</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">W</span>
                        <input type="number" class="process-input" data-proc="${idx}" data-point="${pointKey}" data-field="w"
                               value="${(point.w * 1000).toFixed(2)}" step="0.1">
                        <span class="process-field-unit">g/kg</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">h</span>
                        <input type="number" class="process-input" data-proc="${idx}" data-point="${pointKey}" data-field="h"
                               value="${props.h.toFixed(1)}" step="0.5">
                        <span class="process-field-unit">kJ/kg</span>
                    </div>
                </div>
            </div>`;
    }

    /** Update all non-focused inputs for a point block after an edit */
    function refreshPointInputs(block, point, props, skipField) {
        block.querySelectorAll('.process-input').forEach(inp => {
            if (document.activeElement === inp) return;
            const f = inp.dataset.field;
            if (f === skipField) return;
            switch (f) {
                case 'tdb': inp.value = displayTemp(point.tdb).toFixed(1); break;
                case 'rh':  inp.value = (props.RH * 100).toFixed(1); break;
                case 'twb': inp.value = displayTemp(props.Twb).toFixed(1); break;
                case 'w':   inp.value = (point.w * 1000).toFixed(2); break;
                case 'h':   inp.value = props.h.toFixed(1); break;
            }
        });
    }

    /** Render the sidebar process list */
    function renderProcessList() {
        processListEl.innerHTML = '';
        if (processes.length === 0) {
            processEmptyEl.classList.remove('hidden');
            return;
        }
        processEmptyEl.classList.add('hidden');

        processes.forEach((proc, idx) => {
            const propsA = Psychro.allProps(proc.pointA.tdb, proc.pointA.w);
            const propsB = Psychro.allProps(proc.pointB.tdb, proc.pointB.w);
            const type = detectProcessType(proc.pointA, proc.pointB);
            const dH = propsB.h - propsA.h;
            const dW = (proc.pointB.w - proc.pointA.w) * 1000;

            const card = document.createElement('div');
            card.className = 'process-card';
            card.innerHTML = `
                <div class="process-card-header">
                    <input type="checkbox" class="process-select-cb" data-idx="${idx}" ${selectedSet.has(idx) ? 'checked' : ''}>
                    <div class="process-swatch" style="background:${proc.color}"></div>
                    <div class="process-type">${type}</div>
                    <button class="process-delete-btn" title="Delete process" data-idx="${idx}">✕</button>
                </div>
                ${buildPointEditHTML(idx, 'A', proc.pointA, propsA, proc.color)}
                <div class="process-arrow-sep">↓</div>
                ${buildPointEditHTML(idx, 'B', proc.pointB, propsB, proc.color)}
                <div class="process-deltas">∆h: ${dH >= 0 ? '+' : ''}${dH.toFixed(1)} kJ/kg  ∆W: ${dW >= 0 ? '+' : ''}${dW.toFixed(1)} g/kg</div>
            `;

            // Editable input handlers
            card.querySelectorAll('.process-input').forEach(inp => {
                inp.addEventListener('input', () => {
                    const procIdx = parseInt(inp.dataset.proc, 10);
                    const pointKey = inp.dataset.point;
                    const field = inp.dataset.field;
                    const val = parseFloat(inp.value);
                    if (isNaN(val)) return;

                    const p = processes[procIdx];
                    const target = pointKey === 'A' ? p.pointA : p.pointB;
                    const resolved = resolveProcessEdit(target.tdb, target.w, field, val);
                    if (!resolved) return;

                    target.tdb = resolved.tdb;
                    target.w = resolved.w;

                    // Recalculate all props for the edited point
                    const newProps = Psychro.allProps(target.tdb, target.w);
                    const pointBlock = inp.closest('.process-point-block');
                    refreshPointInputs(pointBlock, target, newProps, field);

                    // Update type label and deltas
                    const newPropsA = Psychro.allProps(p.pointA.tdb, p.pointA.w);
                    const newPropsB = Psychro.allProps(p.pointB.tdb, p.pointB.w);
                    const newType = detectProcessType(p.pointA, p.pointB);
                    const newDH = newPropsB.h - newPropsA.h;
                    const newDW = (p.pointB.w - p.pointA.w) * 1000;

                    card.querySelector('.process-type').textContent = newType;
                    card.querySelector('.process-deltas').textContent =
                        `\u2206h: ${newDH >= 0 ? '+' : ''}${newDH.toFixed(1)} kJ/kg  \u2206W: ${newDW >= 0 ? '+' : ''}${newDW.toFixed(1)} g/kg`;

                    syncProcessesToChart();
                });
            });

            // Selection checkbox handler
            card.querySelector('.process-select-cb').addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedSet.add(idx);
                    card.classList.add('selected');
                } else {
                    selectedSet.delete(idx);
                    card.classList.remove('selected');
                }
                updateMoveBtn();
            });
            if (selectedSet.has(idx)) card.classList.add('selected');

            // Delete handler
            card.querySelector('.process-delete-btn').addEventListener('click', () => {
                selectedSet.delete(idx);
                processes.splice(idx, 1);
                // Re-index selectedSet
                const newSet = new Set();
                selectedSet.forEach(i => { if (i < idx) newSet.add(i); else if (i > idx) newSet.add(i - 1); });
                selectedSet.clear();
                newSet.forEach(i => selectedSet.add(i));
                updateMoveBtn();
                renderProcessList();
                syncProcessesToChart();
            });
            processListEl.appendChild(card);
        });
    }

    /** Show/hide move button based on selection */
    function updateMoveBtn() {
        moveSelectedBtn.classList.toggle('visible', selectedSet.size > 0);
        if (selectedSet.size === 0 && moveMode) exitMoveMode();
    }

    /** Enter move mode */
    function enterMoveMode() {
        moveMode = true;
        moveSelectedBtn.classList.add('active');
        processStatus.textContent = '⤡ Drag on chart to move selected processes';
        processStatus.classList.add('visible');
        dynamicCanvas.style.cursor = 'move';
        if (pinnedPoint) unpin();
    }

    /** Exit move mode */
    function exitMoveMode() {
        moveMode = false;
        moveDragStart = null;
        moveOriginals = null;
        moveSelectedBtn.classList.remove('active');
        processStatus.classList.remove('visible');
        dynamicCanvas.style.cursor = 'crosshair';
    }

    /** Enter add-process mode */
    function enterAddMode() {
        addProcessMode = true;
        pendingPointA = null;
        chart.addModePointA = null;
        addProcessBtn.disabled = true;
        cancelProcessBtn.classList.add('visible');
        processStatus.textContent = '⬤ Click Point A on the chart';
        processStatus.classList.add('visible');
        // Unpin if currently pinned so clicks go to add mode
        if (pinnedPoint) unpin();
    }

    /** Exit add-process mode */
    function exitAddMode() {
        addProcessMode = false;
        pendingPointA = null;
        chart.addModePointA = null;
        addProcessBtn.disabled = false;
        cancelProcessBtn.classList.remove('visible');
        processStatus.classList.remove('visible');
        syncProcessesToChart();
    }

    /** Find the nearest existing process point within snap threshold (pixels) */
    function findSnapPoint(tdb, w) {
        if (!snapEnabled) return { tdb, w, snapped: false };
        const SNAP_PX = 15;
        const clickX = chart.tdbToX(tdb);
        const clickY = chart.wToY(w);
        let bestDist = Infinity;
        let bestPt = null;

        for (const proc of processes) {
            for (const pt of [proc.pointA, proc.pointB]) {
                const px = chart.tdbToX(pt.tdb);
                const py = chart.wToY(pt.w);
                const dist = Math.hypot(px - clickX, py - clickY);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestPt = pt;
                }
            }
        }

        if (bestDist <= SNAP_PX && bestPt) {
            return { tdb: bestPt.tdb, w: bestPt.w, snapped: true };
        }
        return { tdb, w, snapped: false };
    }

    /** Handle a click/tap on the chart while in add-process mode */
    function handleProcessClick(clientX, clientY) {
        const hit = chart.hitTest(clientX, clientY);
        if (!hit) return;
        if (!Psychro.isValid(hit.tdb, hit.w)) return;

        // Snap to existing process point if close enough
        const snap = findSnapPoint(hit.tdb, hit.w);

        if (!pendingPointA) {
            // First click = Point A
            pendingPointA = { tdb: snap.tdb, w: snap.w };
            chart.addModePointA = pendingPointA;
            processStatus.textContent = snap.snapped
                ? '⬤ Point A snapped! Now click Point B'
                : '⬤ Now click Point B on the chart';
            // Redraw to show the green A dot
            if (lastProps) {
                chart.drawDynamic(lastProps.Tdb, lastProps.W, lastProps);
            } else {
                chart.drawDynamic(null, null, null);
            }
        } else {
            // Second click = Point B
            const pointB = { tdb: snap.tdb, w: snap.w };
            const color = PROCESS_COLORS[processes.length % PROCESS_COLORS.length];
            processes.push({
                id: processIdCounter++,
                color,
                pointA: pendingPointA,
                pointB
            });
            exitAddMode();
            renderProcessList();
            syncProcessesToChart();
        }
    }

    // ---- Wire up process UI buttons ----
    addProcessBtn.addEventListener('click', () => enterAddMode());
    cancelProcessBtn.addEventListener('click', () => exitAddMode());

    // Snap toggle
    snapToggleBtn.addEventListener('click', () => {
        snapEnabled = !snapEnabled;
        snapToggleBtn.classList.toggle('active', snapEnabled);
    });

    // Move button toggle
    moveSelectedBtn.addEventListener('click', () => {
        if (moveMode) {
            exitMoveMode();
        } else {
            enterMoveMode();
        }
    });

    // Escape key cancels active modes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (addProcessMode) exitAddMode();
            if (moveMode) exitMoveMode();
        }
    });

    // Initial render
    renderProcessList();
});
