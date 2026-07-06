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

    // Zoom/pan state
    let isPanning = false;
    let wasPanning = false;
    let panStartX = 0, panStartY = 0;
    let panOrigView = null;

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

    // ---- AHU Sequence state ----
    let ahuMode = false;
    const ahuChain = {
        oa: null, // { tdb, w }
        ra: null,
        mixRatio: 0.2,
        stages: []
    };
    let ahuAddMode = null; // 'oa', 'ra', or 'stage'
    let stageIdCounter = 0;

    // AHU UI DOM refs
    const modeFreeformBtn = document.getElementById('mode-freeform-btn');
    const modeAhuBtn      = document.getElementById('mode-ahu-btn');
    const freeformContainer = document.getElementById('freeform-container');
    const ahuContainer    = document.getElementById('ahu-container');
    
    const ahuSetOaBtn     = document.getElementById('ahu-set-oa-btn');
    const ahuSetRaBtn     = document.getElementById('ahu-set-ra-btn');
    const ahuCancelBtn    = document.getElementById('ahu-cancel-btn');
    const ahuStatus       = document.getElementById('ahu-status');
    const ahuSystemBlock  = document.getElementById('ahu-system-block');
    const ahuAddStageBtn  = document.getElementById('ahu-add-stage-btn');
    const ahuStageList    = document.getElementById('ahu-stage-list');
    const ahuSummaryFooter = document.getElementById('ahu-summary-footer');
    const ahuNetDh        = document.getElementById('ahu-net-dh');
    const ahuTotalDh      = document.getElementById('ahu-total-dh');

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
        
        // Update elevation input display
        const elevInput = document.getElementById('elevation-input');
        const elevUnit = document.getElementById('elevation-unit');
        if (elevInput && elevUnit) {
            elevUnit.textContent = useFahrenheit ? 'ft' : 'm';
            elevInput.step = useFahrenheit ? '500' : '100';
            elevInput.value = useFahrenheit 
                ? Math.round(currentElevationM * 3.28084) 
                : Math.round(currentElevationM);
        }
        if (lastProps) {
            updateAllInputs(lastProps);
            chart.drawDynamic(lastProps.Tdb, lastProps.W, lastProps);
        }
        renderProcessList();
    }

    /* ---- Elevation handling ---- */
    let currentElevationM = 0;
    const elevInput = document.getElementById('elevation-input');
    if (elevInput) {
        elevInput.addEventListener('change', () => {
            let val = parseFloat(elevInput.value);
            if (isNaN(val)) val = 0;
            
            // Convert to meters if currently in F/feet mode
            if (useFahrenheit) {
                currentElevationM = val * 0.3048;
            } else {
                currentElevationM = val;
            }
            
            Psychro.setAltitude(currentElevationM);
            
            // Update all data/UI
            if (lastProps && pinnedPoint) {
                lastProps = Psychro.allProps(pinnedPoint.tdb, pinnedPoint.w);
            }
            fullRedraw();
            if (lastProps) updateAllInputs(lastProps);
            renderProcessList();
            if (ahuMode) syncAhuToChart();
        });
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

    /* ---- Zoom/Pan controls ---- */
    function fullRedraw() {
        chart.drawStatic();
        if (pinnedPoint && lastProps) {
            chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
        } else {
            chart.drawDynamic(null, null, null);
        }
    }

    function updateZoomBadge() {
        const zoomLevel = chart.getZoomLevel();
        const isDefault = chart.isDefaultZoom();
        const badge = document.getElementById('zoom-badge');
        const resetBtn = document.getElementById('zoom-reset-btn');
        if (!badge || !resetBtn) return;
        if (isDefault) {
            badge.classList.remove('visible');
            resetBtn.style.display = 'none';
        } else {
            badge.textContent = zoomLevel.toFixed(1) + '\u00d7';
            badge.classList.add('visible');
            resetBtn.style.display = 'flex';
        }
    }

    document.getElementById('zoom-reset-btn').addEventListener('click', () => {
        chart.resetZoom();
        fullRedraw();
        updateZoomBadge();
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

    /* ---- Mode Toggle ---- */
    function setAhuMode(enable) {
        ahuMode = enable;
        modeFreeformBtn.classList.toggle('active', !enable);
        modeAhuBtn.classList.toggle('active', enable);
        
        freeformContainer.style.display = enable ? 'none' : 'block';
        ahuContainer.style.display = enable ? 'block' : 'none';
        
        // Reset any active add states
        if (addProcessMode) {
            addProcessMode = false;
            pendingPointA = null;
            addProcessBtn.style.display = 'inline-block';
            cancelProcessBtn.classList.remove('visible');
            processStatus.classList.remove('visible');
        }
        if (ahuAddMode) {
            setAhuAddMode(null);
        }
        
        chart.ahuMode = ahuMode; // tell chart which layer to draw
        
        // Force redraw to swap lines
        if (pinnedPoint && lastProps) {
            chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
        } else {
            chart.drawDynamic(null, null, null);
        }
    }
    
    modeFreeformBtn.addEventListener('click', () => setAhuMode(false));
    modeAhuBtn.addEventListener('click', () => setAhuMode(true));

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
        // Pan drag
        if (isPanning) {
            const dx = e.clientX - panStartX;
            const dy = e.clientY - panStartY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) wasPanning = true;
            const tdbRange = panOrigView.tdbMax - panOrigView.tdbMin;
            const wRange = panOrigView.wMax - panOrigView.wMin;
            chart.viewTdbMin = panOrigView.tdbMin - dx / chart.chartW * tdbRange;
            chart.viewTdbMax = panOrigView.tdbMax - dx / chart.chartW * tdbRange;
            chart.viewWMin = panOrigView.wMin + dy / chart.chartH * wRange;
            chart.viewWMax = panOrigView.wMax + dy / chart.chartH * wRange;
            chart._clampView();
            fullRedraw();
            updateZoomBadge();
            return;
        }

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

    // Move mode + Pan: mousedown to start drag
    dynamicCanvas.addEventListener('mousedown', (e) => {
        // Pan: middle button or Ctrl/Cmd+left
        if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
            isPanning = true;
            wasPanning = false;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panOrigView = {
                tdbMin: chart.viewTdbMin, tdbMax: chart.viewTdbMax,
                wMin: chart.viewWMin, wMax: chart.viewWMax
            };
            dynamicCanvas.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }
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

    // Move mode + Pan: mouseup to finish drag
    dynamicCanvas.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
            dynamicCanvas.style.cursor = moveMode ? 'move' : 'crosshair';
            return;
        }
        if (moveMode && moveDragStart) {
            moveDragStart = null;
            moveOriginals = null;
            renderProcessList();
        }
    });

    dynamicCanvas.addEventListener('click', (e) => {
        // ---- Swallow click after pan ----
        if (wasPanning) { wasPanning = false; return; }
        // ---- Move mode: swallow clicks ----
        if (moveMode) return;
        // ---- Add-process mode intercept ----
        if (addProcessMode) {
            handleProcessClick(e.clientX, e.clientY);
            return;
        }
        // ---- AHU mode intercept ----
        if (ahuAddMode) {
            handleAhuClick(e.clientX, e.clientY);
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
        if (isPanning) return;
        chart.drawDynamic(null, null, null);
        clearValues();
    });

    dynamicCanvas.style.cursor = 'crosshair';

    // Prevent context menu on chart
    dynamicCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Wheel zoom
    dynamicCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const hit = chart.hitTestRaw(e.clientX, e.clientY);
        if (!hit) return;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        chart.zoomAt(hit.tdb, hit.w, factor);
        fullRedraw();
        updateZoomBadge();
    }, { passive: false });

    // End pan if mouse released outside canvas
    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            dynamicCanvas.style.cursor = moveMode ? 'move' : 'crosshair';
        }
    });

    /* ---- Touch interaction (mobile) ---- */
    let touchStartPos = null;
    let isPinching = false;
    let pinchStartDist = 0;
    let pinchStartView = null;
    let pinchStartCenter = null;

    dynamicCanvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            isPinching = true;
            const t1 = e.touches[0], t2 = e.touches[1];
            pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            pinchStartView = {
                tdbMin: chart.viewTdbMin, tdbMax: chart.viewTdbMax,
                wMin: chart.viewWMin, wMax: chart.viewWMax
            };
            pinchStartCenter = {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2
            };
            return;
        }

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
        if (isPinching && e.touches.length === 2) {
            e.preventDefault();
            const t1 = e.touches[0], t2 = e.touches[1];
            const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const factor = newDist / pinchStartDist;

            // Restore original view then zoom
            chart.viewTdbMin = pinchStartView.tdbMin;
            chart.viewTdbMax = pinchStartView.tdbMax;
            chart.viewWMin = pinchStartView.wMin;
            chart.viewWMax = pinchStartView.wMax;

            const rect = dynamicCanvas.getBoundingClientRect();
            const centerTdb = chart.xToTdb(pinchStartCenter.x - rect.left);
            const centerW = chart.yToW(pinchStartCenter.y - rect.top);
            chart.zoomAt(centerTdb, centerW, factor);

            // Pan: keep pinch center under fingers
            const newCenterX = (t1.clientX + t2.clientX) / 2;
            const newCenterY = (t1.clientY + t2.clientY) / 2;
            const panDx = newCenterX - pinchStartCenter.x;
            const panDy = newCenterY - pinchStartCenter.y;
            const tdbRange = chart.viewTdbMax - chart.viewTdbMin;
            const wRange = chart.viewWMax - chart.viewWMin;
            chart.viewTdbMin -= panDx / chart.chartW * tdbRange;
            chart.viewTdbMax -= panDx / chart.chartW * tdbRange;
            chart.viewWMin += panDy / chart.chartH * wRange;
            chart.viewWMax += panDy / chart.chartH * wRange;
            chart._clampView();

            fullRedraw();
            updateZoomBadge();
            return;
        }

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
        if (isPinching) {
            isPinching = false;
            return;
        }
        if (touchStartPos) {
            // Was a tap (no drag)
            if (addProcessMode) {
                handleProcessClick(touchStartPos.x, touchStartPos.y);
            } else if (ahuAddMode) {
                handleAhuClick(touchStartPos.x, touchStartPos.y);
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
                        <span class="process-field-label">Tdp</span>
                        <input type="number" class="process-input" data-proc="${idx}" data-point="${pointKey}" data-field="tdp"
                               value="${displayTemp(props.Tdp).toFixed(1)}" step="0.1">
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
                case 'tdp': inp.value = displayTemp(props.Tdp).toFixed(1); break;
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
            if (ahuAddMode) setAhuAddMode(null);
        }
        // Reset zoom on Home key
        if (e.key === 'Home' && document.activeElement.tagName !== 'INPUT') {
            if (!chart.isDefaultZoom()) {
                chart.resetZoom();
                fullRedraw();
                updateZoomBadge();
            }
        }
    });

    // Initial render
    renderProcessList();

    /* ==========================================================
       AHU SEQUENCE MODE LOGIC
       ========================================================== */

    function getMA() {
        if (!ahuChain.oa || !ahuChain.ra) return null;
        
        const r = ahuChain.mixRatio;
        const wOA = ahuChain.oa.w;
        const wRA = ahuChain.ra.w;
        const hOA = Psychro.enthalpy(ahuChain.oa.tdb, wOA);
        const hRA = Psychro.enthalpy(ahuChain.ra.tdb, wRA);
        
        const wMA = r * wOA + (1 - r) * wRA;
        const hMA = r * hOA + (1 - r) * hRA;
        
        // Inverse of h = 1.006 * Tdb + W * (2501 + 1.86 * Tdb)
        // h - 2501 * W = Tdb * (1.006 + 1.86 * W)
        const tdbMA = (hMA - 2501 * wMA) / (1.006 + 1.86 * wMA);
        
        if (!Psychro.isValid(tdbMA, wMA)) return null; // Safety check
        return { tdb: tdbMA, w: wMA };
    }

    function syncAhuToChart() {
        chart.ahuChain = ahuChain;
        chart.ahuMA = getMA();
        if (pinnedPoint && lastProps) {
            chart.drawDynamic(pinnedPoint.tdb, pinnedPoint.w, lastProps);
        } else {
            chart.drawDynamic(null, null, null);
        }
        renderAhuSidebar();
    }

    function setAhuAddMode(mode) {
        ahuAddMode = mode;
        if (mode) {
            ahuSetOaBtn.style.display = 'none';
            ahuSetRaBtn.style.display = 'none';
            ahuAddStageBtn.style.display = 'none';
            ahuCancelBtn.classList.add('visible');
            ahuStatus.classList.add('visible');
            
            if (mode === 'oa') ahuStatus.textContent = 'Click chart to set Outdoor Air point...';
            else if (mode === 'ra') ahuStatus.textContent = 'Click chart to set Return Air point...';
            else if (mode === 'stage') ahuStatus.textContent = 'Click chart to set Stage Exit point...';
            
            chart.addModePointA = null; // Don't use the green pulsing dot for AHU mode
        } else {
            ahuSetOaBtn.style.display = 'inline-block';
            ahuSetRaBtn.style.display = 'inline-block';
            ahuAddStageBtn.style.display = 'inline-block';
            ahuCancelBtn.classList.remove('visible');
            ahuStatus.classList.remove('visible');
        }
    }

    ahuSetOaBtn.addEventListener('click', () => setAhuAddMode('oa'));
    ahuSetRaBtn.addEventListener('click', () => setAhuAddMode('ra'));
    ahuCancelBtn.addEventListener('click', () => setAhuAddMode(null));
    ahuAddStageBtn.addEventListener('click', () => {
        if (!ahuChain.oa || !ahuChain.ra) return;
        setAhuAddMode('stage');
    });

    function handleAhuClick(clientX, clientY) {
        const hit = chart.hitTest(clientX, clientY);
        if (!hit) return;
        
        const pt = { tdb: hit.tdb, w: hit.w };
        
        if (ahuAddMode === 'oa') {
            ahuChain.oa = pt;
        } else if (ahuAddMode === 'ra') {
            ahuChain.ra = pt;
        } else if (ahuAddMode === 'stage') {
            const entry = ahuChain.stages.length > 0 
                ? ahuChain.stages[ahuChain.stages.length - 1].exit 
                : getMA();
            
            const type = detectProcessType(entry, pt);
            ahuChain.stages.push({
                id: ++stageIdCounter,
                label: type,
                exit: pt
            });
        }
        
        setAhuAddMode(null);
        syncAhuToChart();
    }

    function buildAhuPointEditHTML(pointKey, point, props) {
        const unit = tempUnit();
        return `
            <div class="process-point-block" style="padding-left: 0;">
                <div class="process-pt-header" style="color:var(--text-primary); font-size:10px; width:22px;">${pointKey}</div>
                <div class="process-fields-grid">
                    <div class="process-field">
                        <span class="process-field-label">Tdb</span>
                        <input type="number" class="process-input ahu-input" data-point="${pointKey}" data-field="tdb"
                               value="${displayTemp(point.tdb).toFixed(1)}" step="0.1">
                        <span class="process-field-unit">${unit}</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">RH</span>
                        <input type="number" class="process-input ahu-input" data-point="${pointKey}" data-field="rh"
                               value="${(props.RH * 100).toFixed(1)}" step="0.5">
                        <span class="process-field-unit">%</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">Twb</span>
                        <input type="number" class="process-input ahu-input" data-point="${pointKey}" data-field="twb"
                               value="${displayTemp(props.Twb).toFixed(1)}" step="0.1">
                        <span class="process-field-unit">${unit}</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">Tdp</span>
                        <input type="number" class="process-input ahu-input" data-point="${pointKey}" data-field="tdp"
                               value="${displayTemp(props.Tdp).toFixed(1)}" step="0.1">
                        <span class="process-field-unit">${unit}</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">W</span>
                        <input type="number" class="process-input ahu-input" data-point="${pointKey}" data-field="w"
                               value="${(point.w * 1000).toFixed(2)}" step="0.1">
                        <span class="process-field-unit">g/kg</span>
                    </div>
                    <div class="process-field">
                        <span class="process-field-label">h</span>
                        <input type="number" class="process-input ahu-input" data-point="${pointKey}" data-field="h"
                               value="${props.h.toFixed(1)}" step="0.5">
                        <span class="process-field-unit">kJ/kg</span>
                    </div>
                </div>
            </div>`;
    }

    function renderAhuSidebar() {
        // 1. System Block (OA / RA / MA)
        if (!ahuChain.oa && !ahuChain.ra) {
            ahuSystemBlock.innerHTML = `<div class="process-empty" id="ahu-empty">Set both Outdoor Air and Return Air to begin defining an AHU sequence.</div>`;
            ahuAddStageBtn.style.display = 'none';
            ahuStageList.innerHTML = '';
            ahuSummaryFooter.style.display = 'none';
            return;
        }

        let html = '';
        if (ahuChain.oa) {
            const pOA = Psychro.allProps(ahuChain.oa.tdb, ahuChain.oa.w);
            html += buildAhuPointEditHTML('OA', ahuChain.oa, pOA);
        }
        if (ahuChain.ra) {
            if (ahuChain.oa) html += `<div style="height:6px;"></div>`;
            const pRA = Psychro.allProps(ahuChain.ra.tdb, ahuChain.ra.w);
            html += buildAhuPointEditHTML('RA', ahuChain.ra, pRA);
        }

        if (ahuChain.oa && ahuChain.ra) {
            const ma = getMA();
            const dispRatio = Math.round(ahuChain.mixRatio * 100);
            html += `
                <div class="ahu-mix-slider-wrap">
                    <div class="ahu-mix-slider-label">
                        <span>% Outdoor Air (by mass)</span>
                        <span id="ahu-mix-val">${dispRatio}%</span>
                    </div>
                    <input type="range" class="ahu-mix-slider" id="ahu-mix-slider" min="0" max="100" value="${dispRatio}">
                </div>
            `;
            if (ma) {
                const pMA = Psychro.allProps(ma.tdb, ma.w);
                html += `<div style="height:6px;"></div>` + buildAhuPointEditHTML('MA', ma, pMA);
            }
            ahuAddStageBtn.style.display = 'inline-block';
            ahuAddStageBtn.disabled = false;
        } else {
            ahuAddStageBtn.style.display = 'none';
        }

        ahuSystemBlock.innerHTML = html;

        // Reattach mix slider listener
        const slider = document.getElementById('ahu-mix-slider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                ahuChain.mixRatio = e.target.value / 100;
                document.getElementById('ahu-mix-val').textContent = e.target.value + '%';
                syncAhuToChart();
            });
        }

        // Attach input listeners for OA/RA/MA
        ahuSystemBlock.querySelectorAll('.ahu-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const ptKey = inp.dataset.point; // 'OA', 'RA', 'MA'
                if (ptKey === 'MA') return; // MA is derived, not editable

                const field = inp.dataset.field;
                const val = parseFloat(inp.value);
                if (isNaN(val)) return;

                const pt = ptKey === 'OA' ? ahuChain.oa : ahuChain.ra;
                const newPt = resolveProcessEdit(pt.tdb, pt.w, field, val);
                if (newPt) {
                    if (ptKey === 'OA') ahuChain.oa = newPt;
                    else ahuChain.ra = newPt;
                    syncAhuToChart(); // Re-render everything
                }
            });
            // Disable MA inputs
            if (inp.dataset.point === 'MA') {
                inp.disabled = true;
            }
        });

        // 2. Stage List
        ahuStageList.innerHTML = '';
        let totalDh = 0;
        let entryPoint = getMA();

        ahuChain.stages.forEach((stage, idx) => {
            if (!entryPoint) return;
            
            const pEntry = Psychro.allProps(entryPoint.tdb, entryPoint.w);
            const pExit = Psychro.allProps(stage.exit.tdb, stage.exit.w);
            const dH = pExit.h - pEntry.h;
            const dW = (stage.exit.w - entryPoint.w) * 1000;
            totalDh += Math.abs(dH);

            const isLast = (idx === ahuChain.stages.length - 1);
            
            const card = document.createElement('div');
            card.className = 'ahu-stage-wrap';
            
            let stageHtml = `
                <div class="ahu-stage-connector"></div>
                <div class="ahu-stage-card">
                    <div class="ahu-stage-card-header">
                        <div class="ahu-stage-badge">${idx + 1}</div>
                        <input type="text" class="ahu-stage-label-input" value="${stage.label}" data-idx="${idx}">
                        ${isLast ? `<button class="process-delete-btn ahu-delete-stage" data-idx="${idx}" title="Delete last stage">✕</button>` : ''}
                    </div>
                    ${buildAhuPointEditHTML('Exit', stage.exit, pExit)}
                    <div class="process-deltas" style="padding-left:0;">∆h: ${dH >= 0 ? '+' : ''}${dH.toFixed(1)} kJ/kg  ∆W: ${dW >= 0 ? '+' : ''}${dW.toFixed(1)} g/kg</div>
                </div>
            `;
            card.innerHTML = stageHtml;
            ahuStageList.appendChild(card);

            entryPoint = stage.exit;
        });

        // Stage Listeners
        ahuStageList.querySelectorAll('.ahu-stage-label-input').forEach(inp => {
            inp.addEventListener('change', (e) => {
                const idx = parseInt(inp.dataset.idx, 10);
                ahuChain.stages[idx].label = e.target.value;
            });
        });

        ahuStageList.querySelectorAll('.ahu-delete-stage').forEach(btn => {
            btn.addEventListener('click', (e) => {
                ahuChain.stages.pop(); // Always pop the last one
                syncAhuToChart();
            });
        });

        ahuStageList.querySelectorAll('.ahu-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const card = inp.closest('.ahu-stage-card');
                const labelInp = card.querySelector('.ahu-stage-label-input');
                const idx = parseInt(labelInp.dataset.idx, 10);
                
                const field = inp.dataset.field;
                const val = parseFloat(inp.value);
                if (isNaN(val)) return;

                const pt = ahuChain.stages[idx].exit;
                const newPt = resolveProcessEdit(pt.tdb, pt.w, field, val);
                if (newPt) {
                    ahuChain.stages[idx].exit = newPt;
                    syncAhuToChart();
                }
            });
        });

        // 3. Summary Footer
        if (ahuChain.stages.length > 0 && getMA()) {
            ahuSummaryFooter.style.display = 'block';
            
            const pMA = Psychro.allProps(getMA().tdb, getMA().w);
            const finalExit = ahuChain.stages[ahuChain.stages.length - 1].exit;
            const pFinal = Psychro.allProps(finalExit.tdb, finalExit.w);
            
            const pOA = Psychro.allProps(ahuChain.oa.tdb, ahuChain.oa.w);
            const netDh = pFinal.h - pOA.h;
            
            ahuNetDh.textContent = (netDh > 0 ? '+' : '') + netDh.toFixed(1);
            ahuTotalDh.textContent = totalDh.toFixed(1);
        } else {
            ahuSummaryFooter.style.display = 'none';
        }
    }
});
