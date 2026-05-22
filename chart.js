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

    /* ---- Coordinate transforms (always SI internally) ---- */
    tdbToX(t) { return this.pad.left + (t - this.tdbMin) / (this.tdbMax - this.tdbMin) * this.chartW; }
    wToY(w)   { return this.pad.top + this.chartH - (w - this.wMin) / (this.wMax - this.wMin) * this.chartH; }
    xToTdb(x) { return this.tdbMin + (x - this.pad.left) / this.chartW * (this.tdbMax - this.tdbMin); }
    yToW(y)   { return this.wMin + (this.pad.top + this.chartH - y) / this.chartH * (this.wMax - this.wMin); }

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
        if (this.lineVisible.rh) this._drawRHCurves(ctx);
        if (this.lineVisible.twb) this._drawTwbLines(ctx);
        if (this.lineVisible.enth) this._drawEnthalpyLines(ctx);
        if (this.lineVisible.vol) this._drawVolumeLines(ctx);
        this._drawSatCurve(ctx);
        this._drawAxes(ctx);
        this._drawLegend(ctx);
    }

    _drawGrid(ctx) {
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 0.5;
        ctx.font = '10px Inter, sans-serif';
        ctx.fillStyle = this.colors.gridText;
        ctx.textAlign = 'center';

        // Vertical lines (Tdb)
        for (let t = this.tdbMin; t <= this.tdbMax; t += 5) {
            const x = this.tdbToX(t);
            ctx.beginPath(); ctx.moveTo(x, this.pad.top); ctx.lineTo(x, this.pad.top + this.chartH); ctx.stroke();
            const displayT = this.toDisplayTemp(t);
            ctx.fillText(Math.round(displayT) + this.tempUnit(), x, this.pad.top + this.chartH + 16);
        }

        // Horizontal lines (W)
        ctx.textAlign = 'right';
        for (let wg = 0; wg <= 30; wg += 5) {
            const w = wg / 1000;
            const y = this.wToY(w);
            ctx.beginPath(); ctx.moveTo(this.pad.left, y); ctx.lineTo(this.pad.left + this.chartW, y); ctx.stroke();
            ctx.fillText(wg.toFixed(0), this.pad.left + this.chartW + 28, y + 3);
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
            const W = (targetV * Psychro.P_ATM / (287.042 * TK) - 1) / 1.6078;
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
