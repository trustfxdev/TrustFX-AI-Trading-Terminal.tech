// ============================================================
// TRUSTFX MARKET STRUCTURE ENGINE
// Stage 3.7
//
// Liquidity Sweep
//      -> Displacement
//      -> BOS / CHoCH
//      -> Fair Value Gap
//      -> Later FVG Retest
//      -> Confirmed Entry
//
// Rule-based analysis prototype.
// Signals require confirmation; profitability is not guaranteed.
// ============================================================

const ENGINE_NAME = "TRUSTFX Market Structure Engine";
const ENGINE_VERSION = "1.0";

// ------------------------------------------------------------
// GENERAL HELPERS
// ------------------------------------------------------------

function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : NaN;
}

function round(value, decimals = 5) {
    if (!Number.isFinite(value)) return null;

    const factor = Math.pow(10, decimals);

    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function candleTime(candle) {
    return (
        candle.datetime ??
        candle.time ??
        candle.timestamp ??
        null
    );
}

function normalizeCandles(input) {
    if (!Array.isArray(input)) return [];

    const candles = input
        .map((candle, originalIndex) => ({
            originalIndex,
            time: candleTime(candle),

            open: number(candle.open),
            high: number(candle.high),
            low: number(candle.low),
            close: number(candle.close),

            volume: number(candle.volume)
        }))
        .filter(candle =>
            Number.isFinite(candle.open) &&
            Number.isFinite(candle.high) &&
            Number.isFinite(candle.low) &&
            Number.isFinite(candle.close) &&
            candle.high >= candle.low &&
            candle.high >= Math.max(candle.open, candle.close) &&
            candle.low <= Math.min(candle.open, candle.close)
        );

    // Normalize candle order to oldest -> newest.
    // Twelve Data normally returns newest candles first.
    // ISO date/time strings are suitable for chronological sorting.
    candles.sort((a, b) => {
        const ta = Date.parse(a.time);
        const tb = Date.parse(b.time);

        if (Number.isFinite(ta) && Number.isFinite(tb)) {
            return ta - tb;
        }

        return a.originalIndex - b.originalIndex;
    });

    return candles;
}

function averageBody(candles, endIndex, period = 10) {
    const start = Math.max(0, endIndex - period);
    const bodies = [];

    for (let i = start; i < endIndex; i++) {
        bodies.push(Math.abs(candles[i].close - candles[i].open));
    }

    if (bodies.length === 0) return 0;

    return bodies.reduce((sum, value) => sum + value, 0)
        / bodies.length;
}

function candleBody(candle) {
    return Math.abs(candle.close - candle.open);
}

function candleDirection(candle) {
    if (candle.close > candle.open) return "BULLISH";
    if (candle.close < candle.open) return "BEARISH";

    return "NEUTRAL";
}

function isBullish(candle) {
    return candle.close > candle.open;
}

function isBearish(candle) {
    return candle.close < candle.open;
}

// ------------------------------------------------------------
// SWING DETECTION
// ------------------------------------------------------------

function detectSwings(candles, strength = 2) {
    const swingHighs = [];
    const swingLows = [];

    for (
        let i = strength;
        i < candles.length - strength;
        i++
    ) {
        const current = candles[i];

        let isHigh = true;
        let isLow = true;

        for (let j = 1; j <= strength; j++) {
            if (
                candles[i - j].high >= current.high ||
                candles[i + j].high > current.high
            ) {
                isHigh = false;
            }

            if (
                candles[i - j].low <= current.low ||
                candles[i + j].low < current.low
            ) {
                isLow = false;
            }
        }

        if (isHigh) {
            swingHighs.push({
                index: i,
                time: current.time,
                price: current.high
            });
        }

        if (isLow) {
            swingLows.push({
                index: i,
                time: current.time,
                price: current.low
            });
        }
    }

    return { swingHighs, swingLows };
}

// ------------------------------------------------------------
// MARKET TREND
// ------------------------------------------------------------

function determineTrend(swings) {
    const highs = swings.swingHighs;
    const lows = swings.swingLows;

    if (highs.length < 2 || lows.length < 2) {
        return "NEUTRAL";
    }

    const previousHigh = highs[highs.length - 2].price;
    const latestHigh = highs[highs.length - 1].price;

    const previousLow = lows[lows.length - 2].price;
    const latestLow = lows[lows.length - 1].price;

    const lowerHigh = latestHigh < previousHigh;
    const lowerLow = latestLow < previousLow;

    const higherHigh = latestHigh > previousHigh;
    const higherLow = latestLow > previousLow;

    if (lowerHigh && lowerLow) return "BEARISH";

    if (higherHigh && higherLow) return "BULLISH";

    return "NEUTRAL";
}

// Determine the trend using swings confirmed before a candle.
// This helps classify a break as BOS or CHoCH.
function trendBefore(candles, swings, index) {
    const highs = swings.swingHighs.filter(
        swing => swing.index < index
    );

    const lows = swings.swingLows.filter(
        swing => swing.index < index
    );

    if (highs.length < 2 || lows.length < 2) {
        return "NEUTRAL";
    }

    const previousHigh = highs[highs.length - 2].price;
    const latestHigh = highs[highs.length - 1].price;

    const previousLow = lows[lows.length - 2].price;
    const latestLow = lows[lows.length - 1].price;

    if (
        latestHigh < previousHigh &&
        latestLow < previousLow
    ) {
        return "BEARISH";
    }

    if (
        latestHigh > previousHigh &&
        latestLow > previousLow
    ) {
        return "BULLISH";
    }

    return "NEUTRAL";
}

// ------------------------------------------------------------
// LIQUIDITY SWEEP DETECTION
// ------------------------------------------------------------

function detectLiquiditySweep(candles, swings, lookback = 35) {
    if (candles.length < 5) {
        return null;
    }

    const lastIndex = candles.length - 1;
    const startIndex = Math.max(2, lastIndex - lookback);

    // Scan backward so the most recent valid sweep is considered.
    for (let i = lastIndex; i >= startIndex; i--) {
        const candle = candles[i];

        const priorHighs = swings.swingHighs.filter(
            swing => swing.index < i
        );

        const priorLows = swings.swingLows.filter(
            swing => swing.index < i
        );

        const latestHigh = priorHighs.length
            ? priorHighs[priorHighs.length - 1]
            : null;

        const latestLow = priorLows.length
            ? priorLows[priorLows.length - 1]
            : null;

        // Bullish sweep:
        // Price runs below a prior swing low and closes back above it.
        if (
            latestLow &&
            candle.low < latestLow.price &&
            candle.close > latestLow.price
        ) {
            return {
                detected: true,
                direction: "BULLISH",
                type: "SELL_SIDE_SWEEP",

                index: i,
                time: candle.time,

                liquidityLevel: latestLow.price,

                sweepLow: candle.low,
                sweepHigh: candle.high,

                rejection: true,
                lowSweep: true,
                highSweep: false
            };
        }

        // Bearish sweep:
        // Price runs above a prior swing high and closes back below it.
        if (
            latestHigh &&
            candle.high > latestHigh.price &&
            candle.close < latestHigh.price
        ) {
            return {
                detected: true,
                direction: "BEARISH",
                type: "BUY_SIDE_SWEEP",

                index: i,
                time: candle.time,

                liquidityLevel: latestHigh.price,

                sweepLow: candle.low,
                sweepHigh: candle.high,

                rejection: true,
                lowSweep: false,
                highSweep: true
            };
        }
    }

    return null;
}

// ------------------------------------------------------------
// DISPLACEMENT DETECTION
// ------------------------------------------------------------

function detectDisplacement(
    candles,
    sweep,
    lookahead = 10
) {
    if (!sweep) return null;

    const endIndex = Math.min(
        candles.length - 1,
        sweep.index + lookahead
    );

    // Find the first strong candle in the sweep direction.
    for (
        let i = sweep.index + 1;
        i <= endIndex;
        i++
    ) {
        const candle = candles[i];

        const avgBody = averageBody(candles, i, 10);

        if (avgBody <= 0) continue;

        const body = candleBody(candle);
        const threshold = avgBody * 1.2;

        const bullishDisplacement =
            sweep.direction === "BULLISH" &&
            isBullish(candle) &&
            body >= threshold;

        const bearishDisplacement =
            sweep.direction === "BEARISH" &&
            isBearish(candle) &&
            body >= threshold;

        if (bullishDisplacement || bearishDisplacement) {
            return {
                detected: true,

                direction: sweep.direction,

                index: i,
                time: candle.time,

                body,
                averageBody: avgBody,
                threshold,

                linkedToSweep: true
            };
        }
    }

    return null;
}

// ------------------------------------------------------------
// BOS / CHoCH
// ------------------------------------------------------------

function detectStructureBreak(
    candles,
    swings,
    sweep,
    displacement
) {
    if (!sweep || !displacement) return null;

    const direction = sweep.direction;

    const breakIndex = displacement.index;

    const previousTrend = trendBefore(
        candles,
        swings,
        breakIndex
    );

    const candidateSwings = direction === "BULLISH"
        ? swings.swingHighs
        : swings.swingLows;

    const eligibleSwings = candidateSwings.filter(
        swing =>
            swing.index < breakIndex &&
            swing.index > sweep.index - 40
    );

    if (eligibleSwings.length === 0) {
        return null;
    }

    const levelSwing =
        eligibleSwings[eligibleSwings.length - 1];

    const candle = candles[breakIndex];

    const broken = direction === "BULLISH"
        ? candle.close > levelSwing.price
        : candle.close < levelSwing.price;

    if (!broken) return null;

    let bos = false;
    let choch = false;

    if (previousTrend === direction) {
        bos = true;
    } else if (
        previousTrend !== "NEUTRAL" &&
        previousTrend !== direction
    ) {
        choch = true;
    } else {
        // Do not classify a break as BOS or CHoCH if
        // the preceding trend cannot be determined.
        return null;
    }

    return {
        detected: true,

        bos,
        choch,

        direction,
        previousTrend,

        index: breakIndex,
        time: candle.time,

        brokenLevel: levelSwing.price
    };
}

// ------------------------------------------------------------
// FAIR VALUE GAP DETECTION
// ------------------------------------------------------------

function detectFVGs(
    candles,
    displacement,
    structureBreak
) {
    if (!displacement || !structureBreak) return [];

    const gaps = [];
    const direction = displacement.direction;

    // Use a three-candle gap.
    // The third candle must occur after the displacement candle.
    for (
        let i = Math.max(2, displacement.index);
        i < candles.length;
        i++
    ) {
        if (i <= structureBreak.index) continue;

        const first = candles[i - 2];
        const middle = candles[i - 1];
        const third = candles[i];

        if (direction === "BULLISH") {
            // Bullish FVG: first candle high is below
            // the third candle low.
            if (first.high < third.low) {
                gaps.push({
                    detected: true,
                    direction: "BULLISH",

                    high: third.low,
                    low: first.high,

                    index: i,
                    time: third.time
                });
            }
        }

        if (direction === "BEARISH") {
            // Bearish FVG: first candle low is above
            // the third candle high.
            if (first.low > third.high) {
                gaps.push({
                    detected: true,
                    direction: "BEARISH",

                    high: first.low,
                    low: third.high,

                    index: i,
                    time: third.time
                });
            }
        }
    }

    return gaps;
}

// ------------------------------------------------------------
// FVG INVALIDATION AND RETEST
// ------------------------------------------------------------

function analyzeFVG(candles, fvg) {
    if (!fvg) return null;

    let invalidated = false;
    let firstRetestIndex = null;
    let latestRetestIndex = null;

    const lastIndex = candles.length - 1;

    // Inspect candles after the FVG forms.
    for (
        let i = fvg.index + 1;
        i <= lastIndex;
        i++
    ) {
        const candle = candles[i];

        // A bullish FVG is invalidated when price closes
        // below the bottom of the gap.
        //
        // A bearish FVG is invalidated when price closes
        // above the top of the gap.
        if (
            fvg.direction === "BULLISH" &&
            candle.close < fvg.low
        ) {
            invalidated = true;
            break;
        }

        if (
            fvg.direction === "BEARISH" &&
            candle.close > fvg.high
        ) {
            invalidated = true;
            break;
        }

        // A candle retests the zone when its range overlaps
        // the FVG price range.
        const overlapsZone =
            candle.low <= fvg.high &&
            candle.high >= fvg.low;

        if (overlapsZone) {
            if (firstRetestIndex === null) {
                firstRetestIndex = i;
            }

            // Keep scanning: this is important for Stage 3.7.
            // We retain the latest retest instead of stopping
            // at the first historical touch.
            latestRetestIndex = i;
        }
    }

    const currentCandle = candles[lastIndex];

    const currentOverlaps =
        currentCandle &&
        lastIndex > fvg.index &&
        currentCandle.low <= fvg.high &&
        currentCandle.high >= fvg.low;

    const currentDirectionAgrees =
        fvg.direction === "BULLISH"
            ? isBullish(currentCandle)
            : isBearish(currentCandle);

    const currentRetest =
        !invalidated &&
        currentOverlaps &&
        currentDirectionAgrees;

    let position = "OUTSIDE";

    if (currentCandle) {
        if (currentCandle.close > fvg.high) {
            position = "ABOVE";
        } else if (currentCandle.close < fvg.low) {
            position = "BELOW";
        } else {
            position = "INSIDE";
        }
    }

    return {
        detected: true,

        direction: fvg.direction,

        high: fvg.high,
        low: fvg.low,

        index: fvg.index,
        time: fvg.time,

        invalidated,

        retest: latestRetestIndex !== null,
        firstRetestIndex,
        latestRetestIndex,

        currentRetest,

        position
    };
}

// ------------------------------------------------------------
// ENTRY AND RISK CALCULATIONS
// ------------------------------------------------------------

function calculateTrade(sweep, displacement, fvg, candles) {
    if (!sweep || !displacement || !fvg) {
        return null;
    }

    const current = candles[candles.length - 1];

    if (!current) return null;

    if (fvg.invalidated || !fvg.currentRetest) {
        return null;
    }

    if (sweep.direction !== displacement.direction) {
        return null;
    }

    if (sweep.direction !== fvg.direction) {
        return null;
    }

    const entry = current.close;

    // A stop belongs beyond the actual sweep extreme.
    // The small buffer is provisional and should be calibrated
    // to the instrument's tick size and broker specifications.
    const buffer = Math.abs(entry) >= 100
        ? 0.10
        : 0.0001;

    let stopLoss;
    let riskDistance;

    if (sweep.direction === "BULLISH") {
        stopLoss = sweep.sweepLow - buffer;
        riskDistance = entry - stopLoss;
    } else {
        stopLoss = sweep.sweepHigh + buffer;
        riskDistance = stopLoss - entry;
    }

    // Reject invalid or excessively small risk distances.
    if (
        !Number.isFinite(riskDistance) ||
        riskDistance <= 0
    ) {
        return null;
    }

    const takeProfit1 = sweep.direction === "BULLISH"
        ? entry + riskDistance * 1.5
        : entry - riskDistance * 1.5;

    const takeProfit2 = sweep.direction === "BULLISH"
        ? entry + riskDistance * 2
        : entry - riskDistance * 2;

    const takeProfit3 = sweep.direction === "BULLISH"
        ? entry + riskDistance * 3
        : entry - riskDistance * 3;

    return {
        confirmed: true,

        direction: sweep.direction,
        signal: sweep.direction === "BULLISH" ? "BUY" : "SELL",

        price: round(entry),
        stopLoss: round(stopLoss),

        takeProfit1: round(takeProfit1),
        takeProfit2: round(takeProfit2),
        takeProfit3: round(takeProfit3),

        riskDistance: round(riskDistance),

        riskReward: {
            tp1: 1.5,
            tp2: 2,
            tp3: 3
        },

        fvgHigh: round(fvg.high),
        fvgLow: round(fvg.low),

        sweepTime: sweep.time,
        displacementTime: displacement.time,
        fvgTime: fvg.time
    };
}

// ------------------------------------------------------------
// MAIN ANALYSIS FUNCTION
// ------------------------------------------------------------

export function analyzeMarketStructure(inputCandles, options = {}) {
    const candles = normalizeCandles(inputCandles);

    const symbol = options.symbol ?? "UNKNOWN";
    const interval = options.interval ?? "15min";

    if (candles.length < 20) {
        return {
            status: "WAIT",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,

            symbol,
            interval,

            candleCount: candles.length,

            error: "Insufficient valid candles for analysis.",

            analysis: {
                status: "WAIT",
                reason: "At least 20 valid candles are required."
            }
        };
    }

    const lastIndex = candles.length - 1;
    const current = candles[lastIndex];

    const swings = detectSwings(candles, 2);

    const trend = determineTrend(swings);

    const swingHighs = swings.swingHighs;
    const swingLows = swings.swingLows;

    const latestSwingHigh = swingHighs.length
        ? swingHighs[swingHighs.length - 1]
        : null;

    const previousSwingHigh = swingHighs.length >= 2
        ? swingHighs[swingHighs.length - 2]
        : null;

    const latestSwingLow = swingLows.length
        ? swingLows[swingLows.length - 1]
        : null;

    const previousSwingLow = swingLows.length >= 2
        ? swingLows[swingLows.length - 2]
        : null;

    const lowerHigh = Boolean(
        latestSwingHigh &&
        previousSwingHigh &&
        latestSwingHigh.price < previousSwingHigh.price
    );

    const lowerLow = Boolean(
        latestSwingLow &&
        previousSwingLow &&
        latestSwingLow.price < previousSwingLow.price
    );

    const higherHigh = Boolean(
        latestSwingHigh &&
        previousSwingHigh &&
        latestSwingHigh.price > previousSwingHigh.price
    );

    const higherLow = Boolean(
        latestSwingLow &&
        previousSwingLow &&
        latestSwingLow.price > previousSwingLow.price
    );

    const sweep = detectLiquiditySweep(candles, swings);

    const displacement = sweep
        ? detectDisplacement(candles, sweep)
        : null;

    const structureBreak = sweep && displacement
        ? detectStructureBreak(
            candles,
            swings,
            sweep,
            displacement
        )
        : null;

    const fvgs = structureBreak
        ? detectFVGs(candles, displacement, structureBreak)
        : [];

    // Stage 3.7:
    // Evaluate candidate gaps from newest to oldest.
    // Do not stop merely because an earlier FVG was retested.
    let selectedFVG = null;
    let selectedFVGAnalysis = null;

    for (let i = fvgs.length - 1; i >= 0; i--) {
        const candidate = analyzeFVG(candles, fvgs[i]);

        if (!candidate || candidate.invalidated) {
            continue;
        }

        selectedFVG = fvgs[i];
        selectedFVGAnalysis = candidate;

        // Prefer a current-candle retest.
        if (candidate.currentRetest) {
            break;
        }
    }

    const fvg = selectedFVGAnalysis;

    const sequenceDirection = sweep?.direction ?? "NONE";

    const sweepConfirmed = Boolean(sweep);

    const displacementConfirmed = Boolean(
        sweep &&
        displacement &&
        displacement.direction === sweep.direction
    );

    const structureBreakConfirmed = Boolean(
        structureBreak &&
        (structureBreak.bos || structureBreak.choch) &&
        structureBreak.direction === sequenceDirection
    );

    const fvgConfirmed = Boolean(
        selectedFVG &&
        fvg &&
        fvg.direction === sequenceDirection
    );

    const fvgRetest = Boolean(
        fvg &&
        fvg.currentRetest
    );

    const fvgInvalidated = Boolean(
        fvg &&
        fvg.invalidated
    );

    const trade = (
        sweepConfirmed &&
        displacementConfirmed &&
        structureBreakConfirmed &&
        fvgConfirmed &&
        fvgRetest &&
        !fvgInvalidated
    )
        ? calculateTrade(
            sweep,
            displacement,
            fvg,
            candles
        )
        : null;

    const entryConfirmed = Boolean(trade?.confirmed);

    const confirmations = [
        sweepConfirmed,
        displacementConfirmed,
        structureBreakConfirmed,
        fvgConfirmed,
        fvgRetest,
        !fvgInvalidated,
        Boolean(sweep && displacement &&
            sweep.direction === displacement.direction),
        Boolean(structureBreak &&
            structureBreak.direction === sequenceDirection)
    ];

    const confirmationScore = confirmations.filter(Boolean).length;

    let invalidReason = null;

    if (!sweepConfirmed) {
        invalidReason = "No confirmed liquidity sweep.";
    } else if (!displacementConfirmed) {
        invalidReason = "Waiting for displacement in the sweep direction.";
    } else if (!structureBreakConfirmed) {
        invalidReason = "Waiting for a valid BOS or CHoCH.";
    } else if (!fvgConfirmed) {
        invalidReason = "Waiting for a valid directional FVG.";
    } else if (fvgInvalidated) {
        invalidReason = "The FVG has been invalidated.";
    } else if (!fvgRetest) {
        invalidReason = "Waiting for a later FVG retest candle.";
    } else if (!entryConfirmed) {
        invalidReason = "Entry failed risk or direction validation.";
    }

    const entryStatus = entryConfirmed
        ? trade.signal
        : "WAIT";

    const candleRange = current.high - current.low;

    const candleMetrics = {
        upperWick: round(
            current.high - Math.max(current.open, current.close)
        ),

        lowerWick: round(
            Math.min(current.open, current.close) - current.low
        ),

        range: round(candleRange),

        body: round(candleBody(current))
    };

    return {
        status: entryConfirmed ? entryStatus : "WAIT",

        engine: ENGINE_NAME,
        version: ENGINE_VERSION,

        symbol,
        interval,

        candleCount: candles.length,

        analysis: {
            status: entryConfirmed ? entryStatus : "WAIT",

            candleOrder: "ASCENDING",
            candleCount: candles.length,

            trend,

            structure: trend === "BULLISH"
                ? "HH + HL"
                : trend === "BEARISH"
                    ? "LH + LL"
                    : "MIXED",

            bos: Boolean(structureBreak?.bos),
            bosDirection: structureBreak?.bos
                ? structureBreak.direction
                : "NONE",

            choch: Boolean(structureBreak?.choch),
            chochDirection: structureBreak?.choch
                ? structureBreak.direction
                : "NONE",

            currentPrice: round(current.close),

            swingHigh: round(latestSwingHigh?.price),
            swingLow: round(latestSwingLow?.price),

            previousSwingHigh: round(previousSwingHigh?.price),
            previousSwingLow: round(previousSwingLow?.price),

            lowerHigh,
            lowerLow,
            higherHigh,
            higherLow,

            lastSwingHighTime: latestSwingHigh?.time ?? null,
            lastSwingLowTime: latestSwingLow?.time ?? null,

            liquidity: {
                status: sweep
                    ? `CONFIRMED ${sweep.type.replaceAll("_", "-")}`
                    : "NO CONFIRMED SWEEP",

                detected: sweepConfirmed,

                sweepDirection: sweep?.direction ?? "NONE",

                rejection: Boolean(sweep?.rejection),

                lowSweep: Boolean(sweep?.lowSweep),
                highSweep: Boolean(sweep?.highSweep),

                liquidityLevel: round(sweep?.liquidityLevel),

                sweepLow: round(sweep?.sweepLow),
                sweepHigh: round(sweep?.sweepHigh),

                time: sweep?.time ?? null
            },

            displacement: {
                detected: Boolean(displacement),

                direction: displacement?.direction ?? "NONE",

                index: displacement?.index ?? null,
                time: displacement?.time ?? null,

                body: round(displacement?.body),
                averageBody: round(displacement?.averageBody),
                threshold: round(displacement?.threshold),

                linkedToSweep: Boolean(displacement?.linkedToSweep)
            },

            fvg: fvg
                ? {
                    detected: true,

                    direction: fvg.direction,

                    high: round(fvg.high),
                    low: round(fvg.low),

                    index: fvg.index,
                    time: fvg.time,

                    invalidated: fvg.invalidated,

                    retest: fvg.retest,
                    firstRetestIndex: fvg.firstRetestIndex,
                    latestRetestIndex: fvg.latestRetestIndex,

                    currentRetest: fvg.currentRetest,

                    position: fvg.position
                }
                : {
                    detected: false,

                    direction: "NONE",

                    high: null,
                    low: null,

                    index: null,
                    time: null,

                    invalidated: false,

                    retest: false,
                    firstRetestIndex: null,
                    latestRetestIndex: null,

                    currentRetest: false,

                    position: "OUTSIDE"
                },

            setup: {
                status: entryConfirmed
                    ? "CONFIRMED"
                    : "WAITING",

                sweepConfirmed,
                displacementConfirmed,
                structureBreakConfirmed,

                fvgConfirmed,
                fvgRetest,

                fvgInvalidated
            },

            entry: {
                status: entryStatus,
                confirmed: entryConfirmed,

                direction: trade?.direction ?? "NONE",

                price: trade?.price ?? null,

                stopLoss: trade?.stopLoss ?? null,

                takeProfit1: trade?.takeProfit1 ?? null,
                takeProfit2: trade?.takeProfit2 ?? null,
                takeProfit3: trade?.takeProfit3 ?? null,

                riskDistance: trade?.riskDistance ?? null,

                riskReward: trade?.riskReward ?? null
            },

            confirmationScore: {
                score: confirmationScore,
                maximum: 8,

                percentage: Math.round(
                    (confirmationScore / 8) * 100
                ),

                validThreshold: entryConfirmed
            },

            sequence: {
                sweep: sweep
                    ? {
                        detected: true,
                        index: sweep.index,
                        time: sweep.time,
                        direction: sweep.direction,
                        liquidityLevel: round(sweep.liquidityLevel),
                        sweepLow: round(sweep.sweepLow),
                        sweepHigh: round(sweep.sweepHigh)
                    }
                    : {
                        detected: false,
                        index: null,
                        time: null,
                        direction: "NONE",
                        liquidityLevel: null,
                        sweepLow: null,
                        sweepHigh: null
                    },

                displacement: displacement
                    ? {
                        detected: true,
                        index: displacement.index,
                        time: displacement.time,
                        direction: displacement.direction
                    }
                    : {
                        detected: false,
                        index: null,
                        time: null,
                        direction: "NONE"
                    },

                structureBreak: structureBreak
                    ? {
                        detected: true,

                        bos: structureBreak.bos,
                        choch: structureBreak.choch,

                        direction: structureBreak.direction,
                        previousTrend: structureBreak.previousTrend,

                        index: structureBreak.index,
                        time: structureBreak.time,

                        brokenLevel: round(structureBreak.brokenLevel)
                    }
                    : {
                        detected: false,

                        bos: false,
                        choch: false,

                        direction: "NONE",
                        previousTrend: trend,

                        index: null,
                        time: null,

                        brokenLevel: null
                    },

                fvg: fvg
                    ? {
                        detected: true,

                        index: fvg.index,
                        time: fvg.time,

                        direction: fvg.direction,

                        high: round(fvg.high),
                        low: round(fvg.low),

                        invalidated: fvg.invalidated
                    }
                    : {
                        detected: false,

                        index: null,
                        time: null,

                        direction: "NONE",

                        high: null,
                        low: null,

                        invalidated: false
                    },

                retest: {
                    detected: Boolean(fvg?.retest),

                    currentCandle: fvgRetest,

                    index: fvg?.latestRetestIndex ?? null,

                    time: fvg?.latestRetestIndex !== null &&
                        fvg?.latestRetestIndex !== undefined
                        ? candles[fvg.latestRetestIndex]?.time ?? null
                        : null
                },

                validOrder: Boolean(
                    sweep &&
                    displacement &&
                    structureBreak &&
                    selectedFVG &&
                    sweep.index < displacement.index &&
                    displacement.index <= structureBreak.index &&
                    structureBreak.index < selectedFVG.index
                ),

                invalidReason,

                complete: entryConfirmed
            },

            candleMetrics
        }
    };
}

// ------------------------------------------------------------
// DEFAULT EXPORT
// ------------------------------------------------------------

export default analyzeMarketStructure;
