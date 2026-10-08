// ============================================================
// TRUSTFX MARKET STRUCTURE ENGINE — STAGE 3.6
// Structure Validation + Entry Safety
//
// Sequence:
// Liquidity Sweep
//       ↓
// Matching Displacement
//       ↓
// BOS / CHoCH
//       ↓
// Matching Fair Value Gap
//       ↓
// Later FVG Retest
//       ↓
// Entry + Validated Risk Levels
//
// If the full sequence is not confirmed: WAIT
// ============================================================

const n = v =>
    Number.isFinite(Number(v)) ? Number(v) : 0;

const t = c =>
    String(c.datetime || c.time || c.date || "");

const o = c => n(c.open);
const h = c => n(c.high);
const l = c => n(c.low);
const cl = c => n(c.close);

const body = c => Math.abs(cl(c) - o(c));
const range = c => h(c) - l(c);

const uw = c =>
    h(c) - Math.max(o(c), cl(c));

const lw = c =>
    Math.min(o(c), cl(c)) - l(c);

const bull = c => cl(c) > o(c);
const bear = c => cl(c) < o(c);


// ============================================================
// 1. NORMALIZE CANDLE DATA
// ============================================================

function normalize(raw) {
    return (Array.isArray(raw) ? raw : [])
        .map(c => ({
            ...c,
            open: o(c),
            high: h(c),
            low: l(c),
            close: cl(c)
        }))
        .filter(c =>
            t(c) &&
            Number.isFinite(new Date(t(c)).getTime()) &&
            h(c) >= l(c) &&
            h(c) >= Math.max(o(c), cl(c)) &&
            l(c) <= Math.min(o(c), cl(c))
        )
        .sort((a, b) =>
            new Date(t(a)).getTime() -
            new Date(t(b)).getTime()
        );
}


// ============================================================
// 2. AVERAGE CANDLE BODY
// ============================================================

function avgBody(c, i, lookback = 20) {
    const values = [];

    for (
        let k = Math.max(0, i - lookback);
        k < i;
        k++
    ) {
        values.push(body(c[k]));
    }

    if (!values.length) return 0;

    return values.reduce((a, b) => a + b, 0)
        / values.length;
}


// ============================================================
// 3. DETECT CONFIRMED SWING HIGHS AND LOWS
// ============================================================

function swings(c) {
    const highs = [];
    const lows = [];

    for (let i = 2; i < c.length - 2; i++) {
        let isHigh = true;
        let isLow = true;

        for (let k = 1; k <= 2; k++) {
            if (
                h(c[i]) <= h(c[i - k]) ||
                h(c[i]) <= h(c[i + k])
            ) {
                isHigh = false;
            }

            if (
                l(c[i]) >= l(c[i - k]) ||
                l(c[i]) >= l(c[i + k])
            ) {
                isLow = false;
            }
        }

        if (isHigh) {
            highs.push({
                index: i,
                price: h(c[i]),
                time: t(c[i])
            });
        }

        if (isLow) {
            lows.push({
                index: i,
                price: l(c[i]),
                time: t(c[i])
            });
        }
    }

    return { highs, lows };
}


// ============================================================
// 4. DETERMINE MARKET STRUCTURE
// ============================================================

function structureOf(s) {
    const hs = s.highs.slice(-2);
    const ls = s.lows.slice(-2);

    const ph = hs.length === 2
        ? hs[0].price
        : null;

    const sh = hs.length
        ? hs[hs.length - 1].price
        : null;

    const pl = ls.length === 2
        ? ls[0].price
        : null;

    const sl = ls.length
        ? ls[ls.length - 1].price
        : null;

    const HH = ph !== null && sh > ph;
    const LH = ph !== null && sh < ph;

    const HL = pl !== null && sl > pl;
    const LL = pl !== null && sl < pl;

    let trend = "NEUTRAL";
    let structure = "UNDEFINED";

    if (HH && HL) {
        trend = "BULLISH";
        structure = "HH + HL";
    } else if (LH && LL) {
        trend = "BEARISH";
        structure = "LH + LL";
    } else if (HH) {
        trend = "BULLISH";
        structure = "HH";
    } else if (HL) {
        trend = "BULLISH";
        structure = "HL";
    } else if (LH) {
        trend = "BEARISH";
        structure = "LH";
    } else if (LL) {
        trend = "BEARISH";
        structure = "LL";
    }

    return {
        trend,
        structure,
        HH,
        HL,
        LH,
        LL,
        sh,
        sl,
        ph,
        pl,
        lastHigh: hs.at(-1) || null,
        lastLow: ls.at(-1) || null,
        highs: s.highs,
        lows: s.lows
    };
}


// ============================================================
// 5. ESTIMATE STRUCTURE BEFORE A PARTICULAR CANDLE
//
// A swing needs two candles on its right to be confirmed.
// We therefore exclude swings that were not yet confirmed
// before the potential structure-break candle.
// ============================================================

function trendBefore(s, index) {
    const confirmedHighs = s.highs.filter(
        x => x.index <= index - 2
    );

    const confirmedLows = s.lows.filter(
        x => x.index <= index - 2
    );

    const hs = confirmedHighs.slice(-2);
    const ls = confirmedLows.slice(-2);

    const HH =
        hs.length === 2 &&
        hs[1].price > hs[0].price;

    const LH =
        hs.length === 2 &&
        hs[1].price < hs[0].price;

    const HL =
        ls.length === 2 &&
        ls[1].price > ls[0].price;

    const LL =
        ls.length === 2 &&
        ls[1].price < ls[0].price;

    if (HH && HL) {
        return "BULLISH";
    }

    if (LH && LL) {
        return "BEARISH";
    }

    if (HH || HL) {
        return "BULLISH";
    }

    if (LH || LL) {
        return "BEARISH";
    }

    return "NEUTRAL";
}


// ============================================================
// 6. FIND LIQUIDITY SWEEPS
//
// Bullish sweep:
// Price moves below a previous swing low, then closes back
// above that liquidity level.
//
// Bearish sweep:
// Price moves above a previous swing high, then closes back
// below that liquidity level.
// ============================================================

function findSweeps(c, s) {
    const out = [];

    const start = Math.max(0, c.length - 35);

    for (let i = start; i < c.length; i++) {

        // SELL-SIDE LIQUIDITY SWEEP = POTENTIAL BUY SETUP

        for (
            let j = s.lows.length - 1;
            j >= 0;
            j--
        ) {
            const q = s.lows[j];

            if (q.index >= i) continue;

            if (
                l(c[i]) < q.price &&
                cl(c[i]) > q.price
            ) {
                const wick = lw(c[i]);
                const b = body(c[i]);

                out.push({
                    type: "SELL-SIDE SWEEP",
                    direction: "BULLISH",
                    index: i,
                    time: t(c[i]),
                    level: q.price,

                    // Actual candle extreme for safer SL.
                    sweepLow: l(c[i]),
                    sweepHigh: h(c[i]),

                    wick,
                    body: b,
                    range: range(c[i]),

                    rejection:
                        range(c[i]) > 0 &&
                        wick >= b * 0.25
                });

                break;
            }
        }


        // BUY-SIDE LIQUIDITY SWEEP = POTENTIAL SELL SETUP

        for (
            let j = s.highs.length - 1;
            j >= 0;
            j--
        ) {
            const q = s.highs[j];

            if (q.index >= i) continue;

            if (
                h(c[i]) > q.price &&
                cl(c[i]) < q.price
            ) {
                const wick = uw(c[i]);
                const b = body(c[i]);

                out.push({
                    type: "BUY-SIDE SWEEP",
                    direction: "BEARISH",
                    index: i,
                    time: t(c[i]),
                    level: q.price,

                    // Actual candle extreme for safer SL.
                    sweepLow: l(c[i]),
                    sweepHigh: h(c[i]),

                    wick,
                    body: b,
                    range: range(c[i]),

                    rejection:
                        range(c[i]) > 0 &&
                        wick >= b * 0.25
                });

                break;
            }
        }
    }

    return out.sort((a, b) => a.index - b.index);
}


// ============================================================
// 7. FIND DISPLACEMENT AFTER A SWEEP
// ============================================================

function displacementAfter(c, sweep) {
    for (
        let i = sweep.index + 1;
        i <= Math.min(c.length - 1, sweep.index + 10);
        i++
    ) {
        const average = avgBody(c, i);
        const candleBody = body(c[i]);

        const direction = bull(c[i])
            ? "BULLISH"
            : bear(c[i])
                ? "BEARISH"
                : "NONE";

        if (
            average > 0 &&
            candleBody >= average * 1.2 &&
            direction === sweep.direction
        ) {
            return {
                detected: true,
                direction,
                index: i,
                time: t(c[i]),
                candleBody,
                averageBody: average,
                threshold: average * 1.2,
                linkedSweep: sweep
            };
        }
    }

    return null;
}


// ============================================================
// 8. VALIDATE BOS OR CHoCH
//
// BOS:
// Break in the same direction as the structure before the break.
//
// CHoCH:
// Break against the structure before the break.
//
// NEUTRAL:
// If prior structure is unclear, the break is not automatically
// labelled BOS or CHoCH.
// ============================================================

function breakAfter(c, s, displacement) {
    const direction = displacement.direction;

    for (
        let i = displacement.index;
        i <= Math.min(
            c.length - 1,
            displacement.index + 10
        );
        i++
    ) {
        const previousTrend = trendBefore(s, i);

        if (direction === "BULLISH") {
            const previousHighs = s.highs.filter(
                x => x.index <= i - 2
            );

            const level = previousHighs.at(-1);

            if (!level || cl(c[i]) <= level.price) {
                continue;
            }

            let bos = false;
            let choch = false;

            if (previousTrend === "BULLISH") {
                bos = true;
            } else if (previousTrend === "BEARISH") {
                choch = true;
            }

            return {
                detected: true,
                index: i,
                time: t(c[i]),
                direction,
                previousTrend,
                bos,
                bosDirection: bos ? direction : "NONE",
                choch,
                chochDirection: choch ? direction : "NONE",
                brokenLevel: level.price,
                brokenLevelTime: level.time
            };
        }


        if (direction === "BEARISH") {
            const previousLows = s.lows.filter(
                x => x.index <= i - 2
            );

            const level = previousLows.at(-1);

            if (!level || cl(c[i]) >= level.price) {
                continue;
            }

            let bos = false;
            let choch = false;

            if (previousTrend === "BEARISH") {
                bos = true;
            } else if (previousTrend === "BULLISH") {
                choch = true;
            }

            return {
                detected: true,
                index: i,
                time: t(c[i]),
                direction,
                previousTrend,
                bos,
                bosDirection: bos ? direction : "NONE",
                choch,
                chochDirection: choch ? direction : "NONE",
                brokenLevel: level.price,
                brokenLevelTime: level.time
            };
        }
    }

    return null;
}


// ============================================================
// 9. FIND A FAIR VALUE GAP
//
// Bullish FVG: current candle low is above the high two
// candles earlier.
//
// Bearish FVG: current candle high is below the low two
// candles earlier.
// ============================================================

function fvgAfter(c, displacement) {
    for (
        let i = Math.max(2, displacement.index);
        i <= Math.min(
            c.length - 1,
            displacement.index + 5
        );
        i++
    ) {
        if (
            displacement.direction === "BULLISH" &&
            l(c[i]) > h(c[i - 2])
        ) {
            return {
                detected: true,
                direction: "BULLISH",
                bullish: true,
                bearish: false,
                high: l(c[i]),
                low: h(c[i - 2]),
                index: i,
                time: t(c[i])
            };
        }

        if (
            displacement.direction === "BEARISH" &&
            h(c[i]) < l(c[i - 2])
        ) {
            return {
                detected: true,
                direction: "BEARISH",
                bullish: false,
                bearish: true,
                high: l(c[i - 2]),
                low: h(c[i]),
                index: i,
                time: t(c[i])
            };
        }
    }

    return {
        detected: false,
        direction: "NONE",
        bullish: false,
        bearish: false,
        high: null,
        low: null,
        index: null,
        time: null
    };
}


// ============================================================
// 10. CHECK WHETHER THE FVG HAS BEEN INVALIDATED
// ============================================================

function invalidatedAfter(c, fvg) {
    if (!fvg.detected) return false;

    for (
        let i = fvg.index + 1;
        i < c.length;
        i++
    ) {
        if (
            fvg.direction === "BULLISH" &&
            cl(c[i]) < fvg.low
        ) {
            return true;
        }

        if (
            fvg.direction === "BEARISH" &&
            cl(c[i]) > fvg.high
        ) {
            return true;
        }
    }

    return false;
}


// ============================================================
// 11. FIND A LATER FVG RETEST
//
// The retest must happen after BOTH the FVG and the structure
// break. A candle that creates the FVG cannot also count as
// its later retest.
// ============================================================

function retestAfter(c, fvg, structureBreak, invalidated) {
    if (
        !fvg.detected ||
        !structureBreak ||
        invalidated
    ) {
        return {
            retest: false,
            index: null,
            time: null,
            position: "NONE"
        };
    }

    const start = Math.max(
        fvg.index + 1,
        structureBreak.index + 1
    );

    for (let i = start; i < c.length; i++) {
        const touchesZone =
            l(c[i]) <= fvg.high &&
            h(c[i]) >= fvg.low;

        if (!touchesZone) continue;

        return {
            retest: true,
            index: i,
            time: t(c[i]),
            position:
                cl(c[i]) > fvg.high
                    ? "ABOVE"
                    : cl(c[i]) < fvg.low
                        ? "BELOW"
                        : "INSIDE"
        };
    }

    return {
        retest: false,
        index: null,
        time: null,
        position: "OUTSIDE"
    };
}


// ============================================================
// 12. CALCULATE AND VALIDATE RISK LEVELS
//
// BUY:
// SL below the actual sweep candle low.
//
// SELL:
// SL above the actual sweep candle high.
//
// TP1 = 1.5R
// TP2 = 2R
// TP3 = 3R
// ============================================================

function risk(direction, entry, sweep) {
    const empty = {
        valid: false,
        reason: "Risk levels not available",
        stopLoss: null,
        takeProfit1: null,
        takeProfit2: null,
        takeProfit3: null,
        riskDistance: null,
        riskReward: null
    };

    if (!sweep || !Number.isFinite(entry)) {
        return empty;
    }

    // Small price buffer. This is a price-based buffer,
    // not a substitute for broker tick-size validation.
    const buffer = entry >= 100
        ? 0.10
        : 0.0001;

    let stopLoss;

    if (direction === "BUY") {
        stopLoss = sweep.sweepLow - buffer;
    } else if (direction === "SELL") {
        stopLoss = sweep.sweepHigh + buffer;
    } else {
        return {
            ...empty,
            reason: "Direction is not BUY or SELL"
        };
    }

    const distance = Math.abs(entry - stopLoss);

    if (
        distance <= 0 ||
        !Number.isFinite(distance) ||
        (direction === "BUY" && stopLoss >= entry) ||
        (direction === "SELL" && stopLoss <= entry)
    ) {
        return {
            ...empty,
            reason: "Stop loss is on the wrong side of entry"
        };
    }

    const sign = direction === "BUY" ? 1 : -1;

    const takeProfit1 = entry + sign * distance * 1.5;
    const takeProfit2 = entry + sign * distance * 2;
    const takeProfit3 = entry + sign * distance * 3;

    if (
        !Number.isFinite(takeProfit1) ||
        !Number.isFinite(takeProfit2) ||
        !Number.isFinite(takeProfit3)
    ) {
        return {
            ...empty,
            reason: "Take-profit calculation failed"
        };
    }

    return {
        valid: true,
        reason: null,
        stopLoss,
        takeProfit1,
        takeProfit2,
        takeProfit3,
        riskDistance: distance,
        riskReward: "1:1.5 / 1:2 / 1:3"
    };
}


// ============================================================
// 13. MAIN MARKET STRUCTURE ANALYSIS
// ============================================================

export function analyzeMarketStructure(rawCandles) {
    const c = normalize(rawCandles);

    if (c.length < 30) {
        return {
            status: "INSUFFICIENT_DATA",
            message: "Not enough candles for market structure analysis.",
            candleCount: c.length
        };
    }

    const cur = c.at(-1);
    const price = cl(cur);

    const s = swings(c);
    const st = structureOf(s);
    const events = findSweeps(c, s);

    let chain = null;


    // --------------------------------------------------------
    // Find the newest complete chronological setup.
    // --------------------------------------------------------

    for (
        let k = events.length - 1;
        k >= 0;
        k--
    ) {
        const sweep = events[k];

        if (!sweep.rejection) continue;

        const displacement = displacementAfter(c, sweep);

        if (
            !displacement ||
            displacement.direction !== sweep.direction ||
            displacement.index <= sweep.index
        ) {
            continue;
        }

        const structureBreak = breakAfter(
            c,
            s,
            displacement
        );

        if (
            !structureBreak ||
            structureBreak.direction !== sweep.direction ||
            structureBreak.index < displacement.index
        ) {
            continue;
        }

        // Require a classified break.
        // Unclear prior structure must not silently count as BOS.
        if (
            !structureBreak.bos &&
            !structureBreak.choch
        ) {
            continue;
        }

        const fvg = fvgAfter(c, displacement);

        if (
            !fvg.detected ||
            fvg.direction !== sweep.direction ||
            fvg.index < displacement.index
        ) {
            continue;
        }

        const invalidated = invalidatedAfter(c, fvg);

        const retest = retestAfter(
            c,
            fvg,
            structureBreak,
            invalidated
        );

        chain = {
            sweep,
            displacement,
            structureBreak,
            fvg,
            invalidated,
            retest,
            validOrder: true
        };

        break;
    }


    // --------------------------------------------------------
    // Build diagnostic output even if setup is incomplete.
    // --------------------------------------------------------

    const sweep =
        chain?.sweep ||
        events.at(-1) ||
        null;

    const displacement =
        chain?.displacement ||
        (
            sweep && sweep.rejection
                ? displacementAfter(c, sweep)
                : null
        );

    const structureBreak =
        chain?.structureBreak ||
        (
            displacement
                ? breakAfter(c, s, displacement)
                : null
        );

    const fvg =
        chain?.fvg ||
        (
            displacement
                ? fvgAfter(c, displacement)
                : {
                    detected: false,
                    direction: "NONE",
                    bullish: false,
                    bearish: false,
                    high: null,
                    low: null,
                    index: null,
                    time: null
                }
        );

    const invalidated =
        chain?.invalidated ??
        invalidatedAfter(c, fvg);

    const retest =
        chain?.retest ||
        retestAfter(
            c,
            fvg,
            structureBreak,
            invalidated
        );

    const disp = displacement || {
        detected: false,
        direction: "NONE",
        index: null,
        time: null,
        candleBody: 0,
        averageBody: 0,
        threshold: 0,
        linkedSweep: null
    };

    const br = structureBreak || {
        detected: false,
        direction: "NONE",
        index: null,
        time: null,
        previousTrend: "NEUTRAL",
        bos: false,
        bosDirection: "NONE",
        choch: false,
        chochDirection: "NONE",
        brokenLevel: null,
        brokenLevelTime: null
    };


    // --------------------------------------------------------
    // Validate entry direction and complete setup.
    // --------------------------------------------------------

    const direction = sweep?.direction || "NONE";

    const entryDirection =
        direction === "BULLISH"
            ? "BUY"
            : direction === "BEARISH"
                ? "SELL"
                : "NONE";

    const currentRetest = Boolean(
        retest.retest &&
        retest.index === c.length - 1
    );

    const candleAgrees =
        entryDirection === "BUY"
            ? bull(cur)
            : entryDirection === "SELL"
                ? bear(cur)
                : false;

    const sequenceDirectionsAgree = Boolean(
        sweep &&
        displacement &&
        structureBreak &&
        fvg.detected &&
        sweep.direction === displacement.direction &&
        displacement.direction === structureBreak.direction &&
        structureBreak.direction === fvg.direction
    );

    const chronologicalOrder = Boolean(
        sweep &&
        displacement &&
        structureBreak &&
        fvg.detected &&
        sweep.index < displacement.index &&
        displacement.index <= structureBreak.index &&
        structureBreak.index <= fvg.index &&
        fvg.index < (retest.index ?? Infinity)
    );

    const structureClassified = Boolean(
        br.bos || br.choch
    );

    const entryCandidate = Boolean(
        chain &&
        !invalidated &&
        currentRetest &&
        candleAgrees &&
        sequenceDirectionsAgree &&
        chronologicalOrder &&
        structureClassified
    );

    const candidateRisk = entryCandidate
        ? risk(entryDirection, price, sweep)
        : {
            valid: false,
            reason: "Entry has not been confirmed",
            stopLoss: null,
            takeProfit1: null,
            takeProfit2: null,
            takeProfit3: null,
            riskDistance: null,
            riskReward: null
        };

    // An entry is confirmed only if the risk calculation passes.
    const confirmed = Boolean(
        entryCandidate &&
        candidateRisk.valid
    );

    const levels = confirmed
        ? candidateRisk
        : {
            stopLoss: null,
            takeProfit1: null,
            takeProfit2: null,
            takeProfit3: null,
            riskDistance: null,
            riskReward: null
        };


    // --------------------------------------------------------
    // Confirmation score.
    // A high score alone does not trigger an entry.
    // --------------------------------------------------------

    const checks = [
        Boolean(sweep?.rejection),

        Boolean(
            sweep &&
            displacement &&
            displacement.index > sweep.index &&
            displacement.direction === direction
        ),

        Boolean(
            structureBreak &&
            structureBreak.direction === direction &&
            (br.bos || br.choch)
        ),

        Boolean(
            fvg.detected &&
            fvg.direction === direction
        ),

        Boolean(
            fvg.detected &&
            !invalidated
        ),

        currentRetest,

        confirmed,

        Boolean(
            chain &&
            chronologicalOrder &&
            sequenceDirectionsAgree
        )
    ];

    const score = checks.filter(Boolean).length;


    // --------------------------------------------------------
    // Explain why the engine is waiting.
    // --------------------------------------------------------

    let reason = null;

    if (!confirmed) {
        if (!sweep) {
            reason = "No liquidity sweep found";
        } else if (!sweep.rejection) {
            reason = "Sweep did not meet rejection rule";
        } else if (!displacement) {
            reason = "No matching displacement after sweep";
        } else if (!structureBreak) {
            reason = "No matching BOS/CHoCH after displacement";
        } else if (!structureClassified) {
            reason = "Structure break is not classified";
        } else if (!fvg.detected) {
            reason = "No matching FVG after displacement";
        } else if (!sequenceDirectionsAgree) {
            reason = "Setup directions do not agree";
        } else if (invalidated) {
            reason = "FVG has been invalidated";
        } else if (!chronologicalOrder) {
            reason = "Setup sequence is not in valid chronological order";
        } else if (!currentRetest) {
            reason = "Waiting for a later FVG retest candle";
        } else if (!candleAgrees) {
            reason = "Retest candle does not confirm entry direction";
        } else if (!candidateRisk.valid) {
            reason = candidateRisk.reason;
        } else {
            reason = "Complete setup not confirmed";
        }
    }


    // --------------------------------------------------------
    // FINAL RESPONSE
    // Keep the existing API output structure compatible.
    // --------------------------------------------------------

    return {
        status: confirmed ? entryDirection : "WAIT",

        candleOrder: "ASCENDING",
        candleCount: c.length,

        trend: st.trend,
        structure: st.structure,

        bos: br.bos,
        bosDirection: br.bosDirection,

        choch: br.choch,
        chochDirection: br.chochDirection,

        currentPrice: price,

        swingHigh: st.sh,
        swingLow: st.sl,

        previousSwingHigh: st.ph,
        previousSwingLow: st.pl,

        higherHigh: st.HH,
        higherLow: st.HL,
        lowerHigh: st.LH,
        lowerLow: st.LL,

        lastSwingHighTime: st.lastHigh?.time || null,
        lastSwingLowTime: st.lastLow?.time || null,


        liquidity: {
            status: sweep
                ? (
                    direction === "BULLISH"
                        ? "CONFIRMED SELL-SIDE SWEEP"
                        : "CONFIRMED BUY-SIDE SWEEP"
                )
                : "NO SWEEP",

            buySideLiquidity: st.sh,
            sellSideLiquidity: st.sl,

            previousBuySideLiquidity: st.ph,
            previousSellSideLiquidity: st.pl,

            sweep: Boolean(sweep),
            sweepDirection: direction,

            rejection: Boolean(sweep?.rejection),
            rejectionDirection: direction,

            highSweep: direction === "BEARISH",
            lowSweep: direction === "BULLISH",

            bearishRejection: Boolean(
                direction === "BEARISH" &&
                sweep?.rejection
            ),

            bullishRejection: Boolean(
                direction === "BULLISH" &&
                sweep?.rejection
            ),

            upperWick: uw(cur),
            lowerWick: lw(cur),
            candleRange: range(cur),
            candleBody: body(cur)
        },


        displacement: {
            status: disp.detected
                ? "DISPLACEMENT DETECTED"
                : "NO DISPLACEMENT",

            detected: disp.detected,
            direction: disp.direction,
            time: disp.time,
            index: disp.index,

            candleBody: disp.candleBody,
            averageBody: disp.averageBody,
            threshold: disp.threshold,

            multiplier: 1.2,

            linkedToSweep: Boolean(
                disp.linkedSweep &&
                sweep &&
                disp.linkedSweep.index === sweep.index &&
                disp.index > sweep.index
            )
        },


        fvg: {
            status: fvg.detected
                ? "RELEVANT FVG DETECTED"
                : "NO RELEVANT FVG",

            detected: fvg.detected,
            direction: fvg.direction,

            bullish: fvg.bullish,
            bearish: fvg.bearish,

            high: fvg.high,
            low: fvg.low,

            index: fvg.index,
            time: fvg.time,

            invalidated,
            retest: currentRetest,
            position: retest.position
        },


        setup: {
            status: confirmed
                ? "CONFIRMED"
                : "WAITING",

            direction: confirmed
                ? entryDirection
                : "NONE",

            bullishSetup: confirmed &&
                entryDirection === "BUY",

            bearishSetup: confirmed &&
                entryDirection === "SELL",

            sweepConfirmed: Boolean(
                sweep?.rejection
            ),

            displacementConfirmed: Boolean(
                sweep &&
                displacement &&
                displacement.direction === direction &&
                displacement.index > sweep.index
            ),

            structureBreakConfirmed: Boolean(
                structureBreak &&
                structureBreak.direction === direction &&
                (br.bos || br.choch)
            ),

            fvgRetest: currentRetest,
            fvgInvalidated: invalidated
        },


        entry: {
            status: confirmed
                ? "CONFIRMED"
                : "WAITING",

            direction: confirmed
                ? entryDirection
                : "NONE",

            confirmed,

            price: confirmed ? price : null,

            ...levels
        },


        confirmationScore: score,
        maxConfirmationScore: 8,

        confirmationPercent: Math.round(
            score / 8 * 100
        ),

        validThreshold: confirmed && score >= 6,


        sequence: {
            sweep: sweep
                ? {
                    detected: true,
                    direction: sweep.direction,
                    type: sweep.type,
                    index: sweep.index,
                    time: sweep.time,
                    level: sweep.level,
                    sweepLow: sweep.sweepLow,
                    sweepHigh: sweep.sweepHigh,
                    rejection: sweep.rejection
                }
                : {
                    detected: false,
                    direction: "NONE",
                    type: null,
                    index: null,
                    time: null,
                    level: null,
                    sweepLow: null,
                    sweepHigh: null,
                    rejection: false
                },


            displacement: {
                detected: disp.detected,
                direction: disp.direction,
                index: disp.index,
                time: disp.time,

                linkedToSweep: Boolean(
                    disp.linkedSweep &&
                    sweep &&
                    disp.linkedSweep.index === sweep.index
                )
            },


            structureBreak: {
                detected: br.detected,

                bos: br.bos,
                bosDirection: br.bosDirection,

                choch: br.choch,
                chochDirection: br.chochDirection,

                direction: br.direction,
                previousTrend: br.previousTrend,

                index: br.index,
                time: br.time,

                brokenLevel: br.brokenLevel,
                brokenLevelTime: br.brokenLevelTime
            },


            fvg: {
                detected: fvg.detected,
                direction: fvg.direction,
                index: fvg.index,
                time: fvg.time,
                retest: currentRetest,
                invalidated
            },


            retest: {
                detected: retest.index !== null,
                currentCandle: currentRetest,
                index: retest.index,
                time: retest.time
            },


            validOrder: Boolean(
                chain &&
                chronologicalOrder &&
                sequenceDirectionsAgree
            ),

            invalidReason: reason,

            complete: confirmed
        }
    };
}
