/**
 * Psychrometric Calculation Engine
 * Based on ASHRAE Handbook — Fundamentals (SI Units)
 * Standard atmospheric pressure: 101325 Pa (sea level)
 */
const Psychro = (() => {
    const P_ATM = 101325; // Pa

    // ASHRAE coefficients for saturation pressure over liquid water (0–200°C)
    const C8  = -5.8002206e3;
    const C9  =  1.3914993;
    const C10 = -4.8640239e-2;
    const C11 =  4.1764768e-5;
    const C12 = -1.4452093e-8;
    const C13 =  6.5459673;

    // ASHRAE coefficients for saturation pressure over ice (< 0°C)
    const C1 = -5.6745359e3;
    const C2 =  6.3925247;
    const C3 = -9.677843e-3;
    const C4 =  6.2215701e-7;
    const C5 =  2.0747825e-9;
    const C6 = -9.484024e-13;
    const C7 =  4.1635019;

    /**
     * Saturation pressure of water vapour (Pa)
     * @param {number} T - Dry-bulb temperature (°C)
     */
    function satPressure(T) {
        const TK = T + 273.15;
        let lnPws;
        if (T >= 0) {
            lnPws = C8/TK + C9 + C10*TK + C11*TK*TK + C12*TK*TK*TK + C13*Math.log(TK);
        } else {
            lnPws = C1/TK + C2 + C3*TK + C4*TK*TK + C5*TK*TK*TK + C6*Math.pow(TK,4) + C7*Math.log(TK);
        }
        return Math.exp(lnPws);
    }

    /**
     * Saturation humidity ratio (kg/kg dry air)
     */
    function satHumidityRatio(T, P) {
        P = P || P_ATM;
        const Pws = satPressure(T);
        if (Pws >= P) return 0.3; // clamp
        return 0.621945 * Pws / (P - Pws);
    }

    /**
     * Humidity ratio from Tdb and RH (kg/kg)
     */
    function humidityRatio(Tdb, RH, P) {
        P = P || P_ATM;
        const Pws = satPressure(Tdb);
        const Pw = RH * Pws;
        if (Pw >= P) return 0.3;
        return 0.621945 * Pw / (P - Pw);
    }

    /**
     * Partial pressure of water vapour (Pa)
     */
    function partialPressure(W, P) {
        P = P || P_ATM;
        return W * P / (0.621945 + W);
    }

    /**
     * Relative humidity (0–1) from Tdb and W
     */
    function relHumidity(Tdb, W, P) {
        P = P || P_ATM;
        const Pws = satPressure(Tdb);
        const Pw = partialPressure(W, P);
        return Math.min(Math.max(Pw / Pws, 0), 1);
    }

    /**
     * Dew point temperature (°C) from humidity ratio
     * Uses bisection method for accuracy
     */
    function dewPoint(W, P) {
        P = P || P_ATM;
        const Pw = partialPressure(W, P);
        if (Pw <= 0) return -60;
        // Bisection: find T where satPressure(T) = Pw
        let lo = -60, hi = 80;
        for (let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if (satPressure(mid) < Pw) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    }

    /**
     * Wet bulb temperature (°C) from Tdb and W
     * Uses bisection on the psychrometric equation
     */
    function wetBulb(Tdb, W, P) {
        P = P || P_ATM;
        // For a given Twb guess, compute what W would be
        function wFromTwb(Twb) {
            const Ws_wb = satHumidityRatio(Twb, P);
            if (Tdb >= 0) {
                return ((2501 - 2.326 * Twb) * Ws_wb - 1.006 * (Tdb - Twb)) /
                       (2501 + 1.86 * Tdb - 4.186 * Twb);
            } else {
                return ((2830 - 0.24 * Twb) * Ws_wb - 1.006 * (Tdb - Twb)) /
                       (2830 + 1.86 * Tdb - 2.1 * Twb);
            }
        }
        // Bisection: find Twb where wFromTwb(Twb) = W
        let lo = -20, hi = Tdb;
        for (let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if (wFromTwb(mid) > W) hi = mid;
            else lo = mid;
        }
        return (lo + hi) / 2;
    }

    /**
     * Moist air enthalpy (kJ/kg dry air)
     * h = 1.006·Tdb + W·(2501 + 1.86·Tdb)
     */
    function enthalpy(Tdb, W) {
        return 1.006 * Tdb + W * (2501 + 1.86 * Tdb);
    }

    /**
     * Specific volume of moist air (m³/kg dry air)
     * v = Ra·TK·(1 + 1.6078·W) / P
     * Ra = 287.042 J/(kg·K)
     */
    function specVolume(Tdb, W, P) {
        P = P || P_ATM;
        const TK = Tdb + 273.15;
        return 287.042 * TK * (1 + 1.6078 * W) / P;
    }

    /**
     * Compute all properties from Tdb and W
     */
    function allProps(Tdb, W, P) {
        P = P || P_ATM;
        const RH = relHumidity(Tdb, W, P);
        const Tdp = dewPoint(W, P);
        const Twb = wetBulb(Tdb, W, P);
        const h = enthalpy(Tdb, W);
        const v = specVolume(Tdb, W, P);
        const Pw = partialPressure(W, P);
        const Pws = satPressure(Tdb);
        return { Tdb, W, RH, Tdp, Twb, h, v, Pw, Pws, P };
    }

    /**
     * Check if a (Tdb, W) point is valid (below saturation curve)
     */
    function isValid(Tdb, W, P) {
        P = P || P_ATM;
        const Ws = satHumidityRatio(Tdb, P);
        return W >= 0 && W <= Ws * 1.001;
    }

    return {
        P_ATM, satPressure, satHumidityRatio, humidityRatio,
        partialPressure, relHumidity, dewPoint, wetBulb,
        enthalpy, specVolume, allProps, isValid
    };
})();
