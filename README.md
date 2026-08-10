# ψ Interactive Psychrometric Chart

> **An ASHRAE-accurate, fully interactive psychrometric chart — no frameworks, no build steps, just pure HTML, CSS & JavaScript.**

I've always found psychrometric charts irritating to read manually (yes, I'm that person). So I built one you can actually *play* with. U can hover around, pin a point, tweak any value, and watch everything update in real time. It even shows you the math behind every number with live-rendered formulas.

**The ideas, layout, and design are all mine.** The coding was done with the help of Antigravity. Every feature, every toggle, every decision came from my head. The AI just made it happen faster. And tbh it did a pretty amazing job at that I feel

---

## What Can It Do ?(As explained by Claude.)

### 📐 The Chart
- **Dual-canvas rendering** — silky smooth crosshair on top of a static grid
- **All the lines you'd expect** — RH curves, Wet Bulb, Enthalpy, Specific Volume — each toggleable on/off
- **Saturation curve** drawn from actual ASHRAE equations (not some approximation)
- **Colored value labels** follow your cursor around — tiny, crisp, and out of your way
- **Light & Dark themes** — auto-detects your OS preference, or flip the switch yourself

### 🖱️ Interacting With It
- **Hover to explore** — the crosshair follows you everywhere with live readouts
- **Click to pin** — lock a state point, then go wild editing values
- **Edit ANY property** — Tdb, RH, Twb, Tdp, W, h, v, Pw — all of them, not just the obvious two
- **▲/▼ stepper arrows** — for when you want to nudge a value up or down
- **Touch support** — drag to explore, tap to pin — works on your phone too

### 🔧 Controls
- **°C / °F toggle** — because sometimes you need freedom units
- **Line toggles** — hide the lines you don't care about
- **Labels toggle** — too much info on screen? Turn 'em off

### 📝 Live Formulas
- **8 equations rendered with KaTeX** — updating in real time with your actual values
- They live in their own tab so they have room to breathe
---

## 🧮 The Math

Everything follows **ASHRAE Handbook — Fundamentals (SI)** at standard atmospheric pressure (101 325 Pa):

| Property | How It's Calculated |
|---|---|
| Saturation Pressure | Hyland-Wexler correlation with ASHRAE coefficients |
| Humidity Ratio | `W = 0.621945 × Pw / (P − Pw)` |
| Enthalpy | `h = 1.006·Tdb + W·(2501 + 1.86·Tdb)` kJ/kg |
| Specific Volume | `v = Ra·TK·(1 + 1.6078·W) / P` m³/kg |
| Dew Point | Inverse saturation pressure solve |
| Wet Bulb | Iterative psychrometric equation (bisection) |

No hand-wavy approximations. Just the real deal.

---

## 📁 What's Inside

```
psychrometric-chart/
├── index.html      # The page — tabs, header, controls
├── styles.css      # All the styling & themes
├── psychro.js      # The brain — ASHRAE calculation engine
├── chart.js        # The eyes — canvas rendering
├── app.js          # The glue — events, editing, formulas
└── README.md       # You are here
```

---

## 📱 Works on Mobile

Yep. Drag your finger across the chart to explore, tap to pin. The layout flips to vertical on smaller screens. 
Is it *as nice* as on a big monitor? Honestly no
Psychrometric charts deserve screen real estate — but if u want to check on phone it works.

---

## 🚀 How to Run It

Just open `index.html`. That's it. No `npm install`, no webpack, no 47 config files. Double-click and go.

The only external things it loads (via CDN) are [KaTeX](https://katex.org/) for pretty math and a couple of [Google Fonts](https://fonts.google.com/).

---

## 📄 License

MIT — use it however you want. Learn from it, fork it, put it on a big screen in your office. I don't really care...(As long as u have fun with it).

---

**Built for HVAC engineers, mechanical engineering students, and anyone who thinks this stuff is actually pretty cool (like me).** If you also struggled to manually read these chart like I did, I hope this tool makes your day a little better. Enjoy!!
