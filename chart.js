/**
 * PsychroChart — Canvas-based psychrometric chart renderer
 * Uses two overlaid canvases: static (background) and dynamic (crosshair)
 * Supports °C (SI) and °F (IP) display modes
 */
class PsychroChart {
    constructor(staticCanvas, dynamicCanvas) {
        this.sc = staticCanvas;
        this.dc = dynamicCanvas;
        this.sctx = staticCanvas.getContext('2d');
        this.dctx = dynamicCanvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        // Chart range (always stored in SI internally)
        this.tdbMin = 0; this.tdbMax = 55;
        this.wMin = 0;   this.wMax = 0.030; // kg/kg

        // View bounds (visible range — changes with zoom/pan)
        this.viewTdbMin = this.tdbMin;
        this.viewTdbMax = this.tdbMax;
        this.viewWMin = this.wMin;
        this.viewWMax = this.wMax;

        // Padding
        this.pad = { top: 40, right: 70, bottom: 50, left: 50 };

        // Theme colours (set by setTheme)
        this.colors = {};
        this.isDark = false;

        // Unit system: 'SI' or 'IP'
        this.unitSystem = 'SI';

        // Pre-drawn line values
        this.rhLines   = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
        this.twbLines  = [];
        for (let t = 0; t <= 35; t += 5) this.twbLines.push(t);
        this.hLines    = [];
        for (let h = 10; h <= 130; h += 10) this.hLines.push(h);
        this.vLines    = [];
        for (let v = 0.74; v <= 0.98; v += 0.02) this.vLines.push(parseFloat(v.toFixed(2)));

        // Pinned state
        this.isPinned = false;

        // Line visibility (toggled from UI)
        this.lineVisible = { rh: true, twb: true, enth: true, vol: true };

        // Show value labels on crosshair
        this.showLabels = true;

        // Process lines data (set from app.js)
        this.processes = [];
        this.addModePointA = null;  // { tdb, w } during add mode

        this.resize();
    }

    /* ---- Unit conversion helpers ---- */
    toDisplayTemp(tC) {
        return this.unitSystem === 'IP' ? tC * 9 / 5 + 32 : tC;
    }
    fromDisplayTemp(tDisp) {
        return this.unitSystem === 'IP' ? (tDisp - 32) * 5 / 9 : tDisp;
    }
    tempUnit() {
        return this.unitSystem === 'IP' ? '°F' : '°C';
    }

    setUnitSystem(sys) {
        this.unitSystem = sys; // 'SI' or 'IP'
    }

    resize() {
        const rect = this.sc.parentElement.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        [this.sc, this.dc].forEach(c => {
            c.width = w * this.dpr;
            c.height = h * this.dpr;
            c.style.width = w + 'px';
            c.style.height = h + 'px';
            c.getContext('2d').setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        });
        this.W = w;
        this.H = h;
        this.chartW = w - this.pad.left - this.pad.right;
        this.chartH = h - this.pad.top - this.pad.bottom;
    }

    /* ---- Coordinate transforms (use view bounds for zoom/pan) ---- */
    tdbToX(t) { return this.pad.left + (t - this.viewTdbMin) / (this.viewTdbMax - this.viewTdbMin) * this.chartW; }
    wToY(w)   { return this.pad.top + this.chartH - (w - this.viewWMin) / (this.viewWMax - this.viewWMin) * this.chartH; }
    xToTdb(x) { return this.viewTdbMin + (x - this.pad.left) / this.chartW * (this.viewTdbMax - this.viewTdbMin); }
    yToW(y)   { return this.viewWMin + (this.pad.top + this.chartH - y) / this.chartH * (this.viewWMax - this.viewWMin); }

    /* ---- Zoom / Pan methods ---- */
    zoomAt(tdbCenter, wCenter, factor) {
        const oldTdbRange = this.viewTdbMax - this.viewTdbMin;
        const oldWRange = this.viewWMax - this.viewWMin;
        const newTdbRange = oldTdbRange / factor;
        const newWRange = oldWRange / factor;
        const tdbFrac = (tdbCenter - this.viewTdbMin) / oldTdbRange;
        const wFrac = (wCenter - this.viewWMin) / oldWRange;
        this.viewTdbMin = tdbCenter - tdbFrac * newTdbRange;
        this.viewTdbMax = this.viewTdbMin + newTdbRange;
        this.viewWMin = wCenter - wFrac * newWRange;
        this.viewWMax = this.viewWMin + newWRange;
        this._clampView();
    }

    panTo(newTdbMin, newTdbMax, newWMin, newWMax) {
        this.viewTdbMin = newTdbMin;
        this.viewTdbMax = newTdbMax;
        this.viewWMin = newWMin;
        this.viewWMax = newWMax;
        this._clampView();
    }

    resetZoom() {
        this.viewTdbMin = this.tdbMin;
        this.viewTdbMax = this.tdbMax;
        this.viewWMin = this.wMin;
        this.viewWMax = this.wMax;
    }

    getZoomLevel() {
        const defaultRange = this.tdbMax - this.tdbMin;
        const currentRange = this.viewTdbMax - this.viewTdbMin;
        return defaultRange / currentRange;
    }

    isDefaultZoom() {
        return Math.abs(this.viewTdbMin - this.tdbMin) < 0.01 &&
               Math.abs(this.viewTdbMax - this.tdbMax) < 0.01 &&
               Math.abs(this.viewWMin - this.wMin) < 0.0001 &&
               Math.abs(this.viewWMax - this.wMax) < 0.0001;
    }

    _clampView() {
        let tdbRange = this.viewTdbMax - this.viewTdbMin;
        let wRange = this.viewWMax - this.viewWMin;
        const maxTdbRange = this.tdbMax - this.tdbMin;
        const minTdbRange = 3;
        const maxWRange = this.wMax - this.wMin;
        const minWRange = 0.002;

        if (tdbRange < minTdbRange) {
            const c = (this.viewTdbMin + this.viewTdbMax) / 2;
            this.viewTdbMin = c - minTdbRange / 2;
            this.viewTdbMax = c + minTdbRange / 2;
            tdbRange = minTdbRange;
        } else if (tdbRange > maxTdbRange) {
            this.viewTdbMin = this.tdbMin;
            this.viewTdbMax = this.tdbMax;
            tdbRange = maxTdbRange;
        }

        if (wRange < minWRange) {
            const c = (this.viewWMin + this.viewWMax) / 2;
            this.viewWMin = c - minWRange / 2;
            this.viewWMax = c + minWRange / 2;
            wRange = minWRange;
        } else if (wRange > maxWRange) {
            this.viewWMin = this.wMin;
            this.viewWMax = this.wMax;
            wRange = maxWRange;
        }

        // Strictly keep within bounds
        if (this.viewTdbMin < this.tdbMin) {
            this.viewTdbMin = this.tdbMin;
            this.viewTdbMax = this.viewTdbMin + tdbRange;
        }
        if (this.viewTdbMax > this.tdbMax) {
            this.viewTdbMax = this.tdbMax;
            this.viewTdbMin = this.viewTdbMax - tdbRange;
        }
        
        if (this.viewWMin < this.wMin) {
            this.viewWMin = this.wMin;
            this.viewWMax = this.viewWMin + wRange;
        }
        if (this.viewWMax > this.wMax) {
            this.viewWMax = this.wMax;
            this.viewWMin = this.viewWMax - wRange;
        }
    }

    _niceStep(range, targetLines) {
        if (range <= 0) return 1;
        const rawStep = range / targetLines;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const res = rawStep / mag;
        let nice;
        if (res <= 1.5) nice = 1;
        else if (res <= 3.5) nice = 2;
        else if (res <= 7.5) nice = 5;
        else nice = 10;
        return nice * mag;
    }

    /** Hit test without validity check (for zoom/pan at any position) */
    hitTestRaw(clientX, clientY) {
        const rect = this.dc.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (x < this.pad.left || x > this.pad.left + this.chartW ||
            y < this.pad.top  || y > this.pad.top + this.chartH) return null;
        return { tdb: this.xToTdb(x), w: this.yToW(y) };
    }

    setTheme(dark) {
        this.isDark = dark;
        if (dark) {
            this.colors = {
                bg: '#0d1117', chartBg: '#161b22',
                grid: '#21262d', gridText: '#8b949e',
                axis: '#c9d1d9', axisText: '#c9d1d9',
                satCurve: '#58a6ff',
                rh: 'rgba(88,166,255,0.35)', rhLabel: '#58a6ff',
                twb: 'rgba(63,185,80,0.30)', twbLabel: '#3fb950',
                enth: 'rgba(248,81,73,0.25)', enthLabel: '#f85149',
                vol: 'rgba(188,140,255,0.25)', volLabel: '#bc8cff',
                crosshair: '#f0c040',
                hlRh: '#58a6ff', hlTwb: '#3fb950', hlH: '#f85149', hlV: '#bc8cff',
                tooltip: '#30363d', tooltipText: '#e6edf3',
                labelBg: 'rgba(22,27,34,0.85)'
            };
        } else {
            this.colors = {
                bg: '#f6f8fa', chartBg: '#ffffff',
                grid: '#e1e4e8', gridText: '#6e7781',
                axis: '#24292f', axisText: '#24292f',
                satCurve: '#0969da',
                rh: 'rgba(9,105,218,0.25)', rhLabel: '#0969da',
                twb: 'rgba(26,127,55,0.25)', twbLabel: '#1a7f37',
                enth: 'rgba(207,34,46,0.20)', enthLabel: '#cf222e',
                vol: 'rgba(130,80,223,0.22)', volLabel: '#8250df',
                crosshair: '#d4880e',
                hlRh: '#0969da', hlTwb: '#1a7f37', hlH: '#cf222e', hlV: '#8250df',
                tooltip: '#ffffff', tooltipText: '#24292f',
                labelBg: 'rgba(255,255,255,0.85)'
            };
        }
    }

    /* ---- Static chart drawing ---- */
    drawStatic() {
        const ctx = this.sctx;
        ctx.clearRect(0, 0, this.W, this.H);

        // Background
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.fillStyle = this.colors.chartBg;
        ctx.fillRect(this.pad.left, this.pad.top, this.chartW, this.chartH);

        this._drawGrid(ctx);

        // Clip curves to chart area for clean zoom/pan
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.pad.left, this.pad.top, this.chartW, this.chartH);
        ctx.clip();

        if (this.lineVisible.rh) this._drawRHCurves(ctx);
        if (this.lineVisible.twb) this._drawTwbLines(ctx);
        if (this.lineVisible.enth) this._drawEnthalpyLines(ctx);
        if (this.lineVisible.vol) this._drawVolumeLines(ctx);
        this._drawSatCurve(ctx);

        ctx.restore();

        this._drawAxes(ctx);
        this._drawLegend(ctx);
    }

    _drawGrid(ctx) {
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 0.5;
        ctx.font = '10px Inter, sans-serif';
        ctx.fillStyle = this.colors.gridText;

        // Adaptive steps in display units for Tdb
        const dispMin = this.toDisplayTemp(this.viewTdbMin);
        const dispMax = this.toDisplayTemp(this.viewTdbMax);
        const dispRange = dispMax - dispMin;
        const dispStep = this._niceStep(dispRange, 10);
        const dispStart = Math.ceil(dispMin / dispStep) * dispStep;
        const numTdb = Math.ceil((dispMax - dispStart) / dispStep) + 2;

        // Adaptive steps for W (in g/kg)
        const wMinG = this.viewWMin * 1000;
        const wMaxG = this.viewWMax * 1000;
        const wRangeG = wMaxG - wMinG;
        const wStepG = this._niceStep(wRangeG, 6);
        const wStartG = Math.ceil(wMinG / wStepG) * wStepG;
        const numW = Math.ceil((wMaxG - wStartG) / wStepG) + 2;

        // Draw gridlines (clipped to chart area)
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.pad.left, this.pad.top, this.chartW, this.chartH);
        ctx.clip();

        for (let i = 0; i < numTdb; i++) {
            const dT = dispStart + i * dispStep;
            if (dT > dispMax + dispStep * 0.5) break;
            const x = this.tdbToX(this.fromDisplayTemp(dT));
            ctx.beginPath(); ctx.moveTo(x, this.pad.top); ctx.lineTo(x, this.pad.top + this.chartH); ctx.stroke();
        }
        for (let i = 0; i < numW; i++) {
            const wg = wStartG + i * wStepG;
            if (wg > wMaxG + wStepG * 0.5) break;
            const y = this.wToY(wg / 1000);
            ctx.beginPath(); ctx.moveTo(this.pad.left, y); ctx.lineTo(this.pad.left + this.chartW, y); ctx.stroke();
        }

        ctx.restore();

        // Draw labels outside clip
        ctx.textAlign = 'center';
        for (let i = 0; i < numTdb; i++) {
            const dT = dispStart + i * dispStep;
            if (dT > dispMax + dispStep * 0.5) break;
            const x = this.tdbToX(this.fromDisplayTemp(dT));
            if (x < this.pad.left - 15 || x > this.pad.left + this.chartW + 15) continue;
            const label = dispStep < 1 ? dT.toFixed(1) : Math.round(dT).toString();
            ctx.fillText(label + this.tempUnit(), x, this.pad.top + this.chartH + 16);
        }
        ctx.textAlign = 'right';
        for (let i = 0; i < numW; i++) {
            const wg = wStartG + i * wStepG;
            if (wg > wMaxG + wStepG * 0.5) break;
            const y = this.wToY(wg / 1000);
            if (y < this.pad.top - 10 || y > this.pad.top + this.chartH + 10) continue;
            const dec = wStepG < 1 ? 1 : 0;
            ctx.fillText(wg.toFixed(dec), this.pad.left + this.chartW + 28, y + 3);
        }
    }

    _drawAxes(ctx) {
        ctx.strokeStyle = this.colors.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.pad.left, this.pad.top);
        ctx.lineTo(this.pad.left, this.pad.top + this.chartH);
        ctx.lineTo(this.pad.left + this.chartW, this.pad.top + this.chartH);
        ctx.lineTo(this.pad.left + this.chartW, this.pad.top);
        ctx.stroke();

        // Axis labels
        ctx.fillStyle = this.colors.axisText;
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Dry Bulb Temperature (' + this.tempUnit() + ')', this.pad.left + this.chartW / 2, this.H - 6);

        ctx.save();
        ctx.translate(this.W - 10, this.pad.top + this.chartH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Humidity Ratio (g/kg)', 0, 0);
        ctx.restore();
    }

    _curvePoints(fn, tStep) {
        tStep = tStep || 0.5;
        const pts = [];
        for (let t = this.tdbMin; t <= this.tdbMax; t += tStep) {
            const w = fn(t);
            if (w !== null && w >= this.wMin && w <= this.wMax) {
                pts.push({ x: this.tdbToX(t), y: this.wToY(w), t, w });
            }
        }
        return pts;
    }

    _drawCurve(ctx, pts, color, width, dash) {
        if (pts.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 1;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    _drawSatCurve(ctx) {
        const pts = this._curvePoints(t => Psychro.satHumidityRatio(t));
        this._drawCurve(ctx, pts, this.colors.satCurve, 2.5);
    }

    _drawRHCurves(ctx) {
        ctx.font = '9px Inter, sans-serif';
        this.rhLines.forEach(rh => {
            if (rh >= 1) return; // sat curve drawn separately
            const pts = this._curvePoints(t => {
                const w = Psychro.humidityRatio(t, rh);
                return w <= Psychro.satHumidityRatio(t) * 1.001 ? w : null;
            });
            this._drawCurve(ctx, pts, this.colors.rh, 1);
            // Label
            if (pts.length > 2) {
                const lp = pts[Math.floor(pts.length * 0.85)];
                if (lp) {
                    ctx.fillStyle = this.colors.rhLabel;
                    ctx.textAlign = 'left';
                    ctx.fillText((rh * 100).toFixed(0) + '%', lp.x + 2, lp.y - 3);
                }
            }
        });
    }

    _drawTwbLines(ctx) {
        ctx.font = '9px Inter, sans-serif';
        this.twbLines.forEach(twb => {
            const pts = [];
            // Walk along Tdb from twb to tdbMax
            for (let tdb = twb; tdb <= this.tdbMax; tdb += 0.5) {
                const Ws_wb = Psychro.satHumidityRatio(twb);
                let W;
                if (tdb >= 0) {
                    W = ((2501 - 2.326 * twb) * Ws_wb - 1.006 * (tdb - twb)) /
                        (2501 + 1.86 * tdb - 4.186 * twb);
                } else {
                    W = ((2830 - 0.24 * twb) * Ws_wb - 1.006 * (tdb - twb)) /
                        (2830 + 1.86 * tdb - 2.1 * twb);
                }
                if (W < this.wMin) break;
                if (W > this.wMax) continue;
                if (W > Psychro.satHumidityRatio(tdb) * 1.001) continue;
                pts.push({ x: this.tdbToX(tdb), y: this.wToY(W) });
            }
            this._drawCurve(ctx, pts, this.colors.twb, 0.8);
            if (pts.length > 1) {
                ctx.fillStyle = this.colors.twbLabel;
                ctx.textAlign = 'right';
                const lp = pts[0];
                const dispT = this.toDisplayTemp(twb);
                ctx.fillText(Math.round(dispT) + '°', lp.x - 2, lp.y - 2);
            }
        });
    }

    _drawEnthalpyLines(ctx) {
        this.hLines.forEach(h => {
            const pts = [];
            for (let tdb = this.tdbMin; tdb <= this.tdbMax; tdb += 0.5) {
                const W = (h - 1.006 * tdb) / (2501 + 1.86 * tdb);
                if (W < this.wMin || W > this.wMax) continue;
                if (W > Psychro.satHumidityRatio(tdb) * 1.001) continue;
                pts.push({ x: this.tdbToX(tdb), y: this.wToY(W) });
            }
            this._drawCurve(ctx, pts, this.colors.enth, 0.6, [4, 3]);
            if (pts.length > 1) {
                ctx.fillStyle = this.colors.enthLabel;
                ctx.font = '8px Inter, sans-serif';
                ctx.textAlign = 'left';
                const lp = pts[0];
                ctx.fillText(h, lp.x - 14, lp.y - 2);
            }
        });
    }

    _drawVolumeLines(ctx) {
        this.vLines.forEach(v => {
            const pts = [];
            for (let tdb = this.tdbMin; tdb <= this.tdbMax; tdb += 0.5) {
                // v = 287.042 * TK * (1 + 1.6078*W) / P → W = (v*P/(287.042*TK) - 1) / 1.6078
                const TK = tdb + 273.15;
                const W = (v * Psychro.P_ATM / (287.042 * TK) - 1) / 1.6078;
                if (W < this.wMin || W > this.wMax) continue;
                if (W > Psychro.satHumidityRatio(tdb) * 1.001) continue;
                pts.push({ x: this.tdbToX(tdb), y: this.wToY(W) });
            }
            this._drawCurve(ctx, pts, this.colors.vol, 0.6, [2, 3]);
            if (pts.length > 1) {
                ctx.fillStyle = this.colors.volLabel;
                ctx.font = '8px Inter, sans-serif';
                ctx.textAlign = 'center';
                const lp = pts[pts.length - 1];
                ctx.fillText(v.toFixed(2), lp.x, lp.y + 12);
            }
        });
    }

    _drawLegend(ctx) {
        const x0 = this.pad.left + 8, y0 = this.pad.top + 8;
        ctx.font = '9px Inter, sans-serif';
        const items = [
            { label: 'RH (%)', color: this.colors.rhLabel, dash: [] },
            { label: 'Wet Bulb (' + this.tempUnit() + ')', color: this.colors.twbLabel, dash: [] },
            { label: 'Enthalpy (kJ/kg)', color: this.colors.enthLabel, dash: [4,3] },
            { label: 'Sp. Volume (m³/kg)', color: this.colors.volLabel, dash: [2,3] },
        ];
        items.forEach((it, i) => {
            const y = y0 + i * 14;
            ctx.strokeStyle = it.color; ctx.lineWidth = 2; ctx.setLineDash(it.dash);
            ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + 18, y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = it.color; ctx.textAlign = 'left';
            ctx.fillText(it.label, x0 + 22, y + 3);
        });
    }

    /* ---- Dynamic overlay (crosshair + highlights + value labels) ---- */
    drawDynamic(tdb, w, props) {
        const ctx = this.dctx;
        ctx.clearRect(0, 0, this.W, this.H);

        // --- Draw process lines (always, even without crosshair) ---
        if (this.ahuMode) {
            this._drawAhuChain(ctx);
        } else {
            this._drawProcessLines(ctx);
        }
        this._drawAddModePoint(ctx);

        if (tdb === null || w === null || !props) return;
        if (!Psychro.isValid(tdb, w)) return;

        const mx = this.tdbToX(tdb);
        const my = this.wToY(w);

        // Clip to chart area
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.pad.left, this.pad.top, this.chartW, this.chartH);
        ctx.clip();

        // --- Highlight existing lines or draw dotted ---
        if (this.lineVisible.rh) this._highlightRH(ctx, tdb, w, props.RH);
        if (this.lineVisible.twb) this._highlightTwb(ctx, tdb, w, props.Twb);
        if (this.lineVisible.enth) this._highlightEnthalpy(ctx, tdb, w, props.h);
        if (this.lineVisible.vol) this._highlightVolume(ctx, tdb, w, props.v);

        // --- Crosshair ---
        ctx.strokeStyle = this.colors.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        // Vertical line (Tdb)
        ctx.beginPath(); ctx.moveTo(mx, this.pad.top); ctx.lineTo(mx, this.pad.top + this.chartH); ctx.stroke();
        // Horizontal line (W)
        ctx.beginPath(); ctx.moveTo(this.pad.left, my); ctx.lineTo(this.pad.left + this.chartW, my); ctx.stroke();
        ctx.setLineDash([]);

        // Crosshair dot
        ctx.fillStyle = this.colors.crosshair;
        ctx.beginPath(); ctx.arc(mx, my, this.isPinned ? 6 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = this.isDark ? '#000' : '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Pinned ring
        if (this.isPinned) {
            ctx.strokeStyle = this.colors.crosshair;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2); ctx.stroke();
        }

        ctx.restore(); // un-clip for labels that may sit near edges

        // --- Value labels on crosshair lines ---
        if (this.showLabels) {
            this._drawValueLabels(ctx, mx, my, tdb, w, props);
        }
    }

    /* ---- Process line rendering ---- */
    _drawProcessLines(ctx) {
        if (!this.processes || this.processes.length === 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(this.pad.left, this.pad.top, this.chartW, this.chartH);
        ctx.clip();

        for (const proc of this.processes) {
            const ax = this.tdbToX(proc.pointA.tdb);
            const ay = this.wToY(proc.pointA.w);
            const bx = this.tdbToX(proc.pointB.tdb);
            const by = this.wToY(proc.pointB.w);
            const color = proc.color;

            // Line A → B
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();

            // Arrowhead at B
            const angle = Math.atan2(by - ay, bx - ax);
            const headLen = 10;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - headLen * Math.cos(angle - Math.PI / 7), by - headLen * Math.sin(angle - Math.PI / 7));
            ctx.lineTo(bx - headLen * Math.cos(angle + Math.PI / 7), by - headLen * Math.sin(angle + Math.PI / 7));
            ctx.closePath();
            ctx.fill();

            // Dots at A and B with data labels
            const pointsData = [
                { x: ax, y: ay, label: 'A', tdb: proc.pointA.tdb, w: proc.pointA.w },
                { x: bx, y: by, label: 'B', tdb: proc.pointB.tdb, w: proc.pointB.w }
            ];
            pointsData.forEach(pt => {
                // Filled circle
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = this.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Data label above the dot
                const dispT = this.toDisplayTemp(pt.tdb).toFixed(1);
                const dispW = (pt.w * 1000).toFixed(1);
                const labelText = `${pt.label}: ${dispT}${this.tempUnit()}, ${dispW} g/kg`;

                ctx.font = "500 8px 'JetBrains Mono', monospace";
                const metrics = ctx.measureText(labelText);
                const tw = metrics.width;
                const th = 11;
                const px = 4, py = 2;
                const bw = tw + px * 2;
                const bh = th + py * 2;

                // Position above the dot, centered
                let lx = pt.x - bw / 2;
                let ly = pt.y - 16 - bh;

                // Clamp to chart bounds
                lx = Math.max(this.pad.left + 2, Math.min(lx, this.pad.left + this.chartW - bw - 2));
                ly = Math.max(this.pad.top + 2, Math.min(ly, this.pad.top + this.chartH - bh - 2));

                // Background pill
                ctx.fillStyle = this.colors.labelBg;
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(lx, ly, bw, bh, 3);
                } else {
                    ctx.rect(lx, ly, bw, bh);
                }
                ctx.fill();

                // Border in process color
                ctx.strokeStyle = color;
                ctx.lineWidth = 0.8;
                ctx.stroke();

                // Text in process color
                ctx.fillStyle = color;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(labelText, lx + px, ly + bh / 2);
            });
        }

        ctx.restore();
    }

    /* ---- AHU Chain rendering ---- */
    _drawAhuChain(ctx) {
        if (!this.ahuChain) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(this.pad.left, this.pad.top, this.chartW, this.chartH);
        ctx.clip();

        const color = '#009688';

        // Helper to draw a line with arrow
        const drawSegment = (ptA, ptB) => {
            const ax = this.tdbToX(ptA.tdb), ay = this.wToY(ptA.w);
            const bx = this.tdbToX(ptB.tdb), by = this.wToY(ptB.w);

            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();

            const angle = Math.atan2(by - ay, bx - ax);
            const headLen = 10;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - headLen * Math.cos(angle - Math.PI / 7), by - headLen * Math.sin(angle - Math.PI / 7));
            ctx.lineTo(bx - headLen * Math.cos(angle + Math.PI / 7), by - headLen * Math.sin(angle + Math.PI / 7));
            ctx.closePath();
            ctx.fill();
        };

        // Helper to draw a node (badge)
        const drawNode = (pt, label) => {
            const px = this.tdbToX(pt.tdb), py = this.wToY(pt.w);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(px, py, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = this.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.font = "600 9px Inter, sans-serif";
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Adjust vertical centering slightly based on font rendering
            ctx.fillText(label, px, py + 0.5);
        };

        const drawLabel = (pt, text) => {
            const px = this.tdbToX(pt.tdb), py = this.wToY(pt.w);
            const dispT = this.toDisplayTemp(pt.tdb).toFixed(1);
            const dispW = (pt.w * 1000).toFixed(1);
            const labelText = `${text}: ${dispT}${this.tempUnit()}, ${dispW} g/kg`;
            
            ctx.font = "500 8px 'JetBrains Mono', monospace";
            const metrics = ctx.measureText(labelText);
            const tw = metrics.width;
            const th = 11;
            const pdx = 4, pdy = 2;
            const bw = tw + pdx * 2;
            const bh = th + pdy * 2;

            let lx = px - bw / 2;
            let ly = py - 18 - bh;
            
            lx = Math.max(this.pad.left + 2, Math.min(lx, this.pad.left + this.chartW - bw - 2));
            ly = Math.max(this.pad.top + 2, Math.min(ly, this.pad.top + this.chartH - bh - 2));

            ctx.fillStyle = this.colors.labelBg;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(lx, ly, bw, bh, 3);
            else ctx.rect(lx, ly, bw, bh);
            ctx.fill();

            ctx.strokeStyle = color;
            ctx.lineWidth = 0.8;
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, lx + pdx, ly + bh / 2);
        };

        // Draw mixing triangle lines if both OA and RA are present
        if (this.ahuChain.oa && this.ahuChain.ra && this.ahuMA) {
            // OA to MA
            drawSegment(this.ahuChain.oa, this.ahuMA);
            // RA to MA
            drawSegment(this.ahuChain.ra, this.ahuMA);
        }

        // Draw stage lines
        let entry = this.ahuMA;
        if (this.ahuChain.stages) {
            this.ahuChain.stages.forEach(stage => {
                if (entry) drawSegment(entry, stage.exit);
                entry = stage.exit;
            });
        }

        // Draw nodes over the lines
        if (this.ahuChain.oa) {
            drawNode(this.ahuChain.oa, 'O');
            drawLabel(this.ahuChain.oa, 'OA');
        }
        if (this.ahuChain.ra) {
            drawNode(this.ahuChain.ra, 'R');
            drawLabel(this.ahuChain.ra, 'RA');
        }
        if (this.ahuChain.oa && this.ahuChain.ra && this.ahuMA) {
            drawNode(this.ahuMA, 'M');
            drawLabel(this.ahuMA, 'MA');
        }

        if (this.ahuChain.stages) {
            this.ahuChain.stages.forEach((stage, idx) => {
                drawNode(stage.exit, (idx + 1).toString());
                drawLabel(stage.exit, `Stg ${idx+1}`);
            });
        }

        ctx.restore();
    }

    /* ---- Pending Point A indicator during add mode ---- */
    _drawAddModePoint(ctx) {
        if (!this.addModePointA) return;

        const x = this.tdbToX(this.addModePointA.tdb);
        const y = this.wToY(this.addModePointA.w);

        ctx.save();
        ctx.beginPath();
        ctx.rect(this.pad.left, this.pad.top, this.chartW, this.chartH);
        ctx.clip();

        // Pulsing outer ring
        ctx.strokeStyle = '#3fb950';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Solid inner dot
        ctx.fillStyle = '#3fb950';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.font = '600 9px Inter, sans-serif';
        ctx.fillStyle = '#3fb950';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('A', x, y - 14);

        ctx.restore();
    }

    /* ---- Value labels drawn on/near the crosshair lines ---- */
    _drawValueLabels(ctx, mx, my, tdb, w, props) {
        const fontSize = 9;
        ctx.font = `400 ${fontSize}px 'JetBrains Mono', monospace`;

        const dispTdb = this.toDisplayTemp(tdb).toFixed(1);
        const wg = (w * 1000).toFixed(1);
        const dispTwb = this.toDisplayTemp(props.Twb).toFixed(1);
        const dispRH = (props.RH * 100).toFixed(1);
        const dispH = props.h.toFixed(1);
        const dispV = props.v.toFixed(3);

        // Tdb label — on vertical crosshair near bottom
        this._drawLabel(ctx, `Tdb=${dispTdb}`, mx, this.pad.top + this.chartH - 6, this.colors.crosshair, 'center', 'bottom');

        // W label — on horizontal crosshair near right
        this._drawLabel(ctx, `W=${wg}`, this.pad.left + this.chartW - 4, my, '#e09030', 'right', 'bottom');

        // RH label — near the cursor, offset upper-left
        this._drawLabel(ctx, `RH=${dispRH}%`, mx + 14, my - 28, this.colors.hlRh, 'left', 'bottom');

        // Twb label — offset
        this._drawLabel(ctx, `Twb=${dispTwb}`, mx + 14, my - 14, this.colors.hlTwb, 'left', 'bottom');

        // Enthalpy label — offset lower
        this._drawLabel(ctx, `h=${dispH}`, mx - 14, my + 16, this.colors.hlH, 'right', 'top');

        // Volume label — offset lower
        this._drawLabel(ctx, `v=${dispV}`, mx - 14, my + 30, this.colors.hlV, 'right', 'top');
    }

    _drawLabel(ctx, text, x, y, color, align, baseline) {
        ctx.font = "400 9px 'JetBrains Mono', monospace";
        const metrics = ctx.measureText(text);
        const tw = metrics.width;
        const th = 12;
        const px = 3, py = 1;

        let rx = x;
        if (align === 'center') rx = x - tw / 2 - px;
        else if (align === 'right') rx = x - tw - px * 2;
        else rx = x;

        let ry = y;
        if (baseline === 'bottom') ry = y - th - py;
        else ry = y;

        // Clamp to chart bounds
        rx = Math.max(this.pad.left + 2, Math.min(rx, this.pad.left + this.chartW - tw - px * 2 - 2));
        ry = Math.max(this.pad.top + 2, Math.min(ry, this.pad.top + this.chartH - th - py * 2 - 2));

        // Background pill
        ctx.fillStyle = this.colors.labelBg;
        ctx.beginPath();
        const r = 3;
        const bw = tw + px * 2;
        const bh = th + py * 2;
        if (ctx.roundRect) {
            ctx.roundRect(rx, ry, bw, bh, r);
        } else {
            ctx.rect(rx, ry, bw, bh);
        }
        ctx.fill();

        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Text
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, rx + px, ry + bh / 2);
    }

    _highlightRH(ctx, tdb, w, rh) {
        const match = this._findClosest(this.rhLines, rh, 0.015);
        const targetRH = match !== null ? match : rh;
        const isMatch = match !== null;

        const pts = this._curvePoints(t => {
            const cw = Psychro.humidityRatio(t, targetRH);
            return cw <= Psychro.satHumidityRatio(t) * 1.001 ? cw : null;
        });
        ctx.strokeStyle = this.colors.hlRh;
        ctx.lineWidth = isMatch ? 2.5 : 1.5;
        ctx.setLineDash(isMatch ? [] : [5, 4]);
        if (pts.length > 1) {
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    _highlightTwb(ctx, tdb, w, twb) {
        const match = this._findClosest(this.twbLines, twb, 0.8);
        const targetTwb = match !== null ? match : twb;
        const isMatch = match !== null;

        const pts = [];
        const Ws_wb = Psychro.satHumidityRatio(targetTwb);
        for (let t = targetTwb; t <= this.tdbMax; t += 0.5) {
            let W;
            if (t >= 0) {
                W = ((2501 - 2.326 * targetTwb) * Ws_wb - 1.006 * (t - targetTwb)) /
                    (2501 + 1.86 * t - 4.186 * targetTwb);
            } else {
                W = ((2830 - 0.24 * targetTwb) * Ws_wb - 1.006 * (t - targetTwb)) /
                    (2830 + 1.86 * t - 2.1 * targetTwb);
            }
            if (W < this.wMin) break;
            if (W > this.wMax || W > Psychro.satHumidityRatio(t) * 1.001) continue;
            pts.push({ x: this.tdbToX(t), y: this.wToY(W) });
        }
        ctx.strokeStyle = this.colors.hlTwb;
        ctx.lineWidth = isMatch ? 2.5 : 1.5;
        ctx.setLineDash(isMatch ? [] : [5, 4]);
        if (pts.length > 1) {
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    _highlightEnthalpy(ctx, tdb, w, h) {
        const match = this._findClosest(this.hLines, h, 1.5);
        const targetH = match !== null ? match : h;
        const isMatch = match !== null;

        const pts = [];
        for (let t = this.tdbMin; t <= this.tdbMax; t += 0.5) {
            const W = (targetH - 1.006 * t) / (2501 + 1.86 * t);
            if (W < this.wMin || W > this.wMax) continue;
            if (W > Psychro.satHumidityRatio(t) * 1.001) continue;
            pts.push({ x: this.tdbToX(t), y: this.wToY(W) });
        }
        ctx.strokeStyle = this.colors.hlH;
        ctx.lineWidth = isMatch ? 2.5 : 1.5;
        ctx.setLineDash(isMatch ? [] : [5, 4]);
        if (pts.length > 1) {
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    _highlightVolume(ctx, tdb, w, v) {
        const match = this._findClosest(this.vLines, v, 0.003);
        const targetV = match !== null ? match : v;
        const isMatch = match !== null;

        const pts = [];
        for (let t = this.tdbMin; t <= this.tdbMax; t += 0.5) {
            const TK = t + 273.15;
            const W = (targetV * Psychro.getPATM() / (287.042 * TK) - 1) / 1.6078;
            if (W < this.wMin || W > this.wMax) continue;
            if (W > Psychro.satHumidityRatio(t) * 1.001) continue;
            pts.push({ x: this.tdbToX(t), y: this.wToY(W) });
        }
        ctx.strokeStyle = this.colors.hlV;
        ctx.lineWidth = isMatch ? 2.5 : 1.5;
        ctx.setLineDash(isMatch ? [] : [5, 4]);
        if (pts.length > 1) {
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    _findClosest(arr, val, threshold) {
        let best = null, bestDist = Infinity;
        for (const v of arr) {
            const d = Math.abs(v - val);
            if (d < bestDist) { bestDist = d; best = v; }
        }
        return bestDist <= threshold ? best : null;
    }

    /* ---- Hit test ---- */
    hitTest(clientX, clientY) {
        const rect = this.dc.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (x < this.pad.left || x > this.pad.left + this.chartW ||
            y < this.pad.top  || y > this.pad.top + this.chartH) return null;
        const tdb = this.xToTdb(x);
        const w   = this.yToW(y);
        if (!Psychro.isValid(tdb, w)) return null;
        return { tdb, w };
    }
}
