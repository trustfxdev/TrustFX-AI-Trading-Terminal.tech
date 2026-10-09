// ============================================================
// TRUSTFX MARKET STRUCTURE ENGINE
// Stage 3.8
//
// Retest Quality + Risk Filter
//
// Sweep -> Displacement -> BOS/CHoCH -> FVG
// -> Quality Retest -> Risk Validation -> Entry
//
// Rule-based prototype. Not a profitability guarantee.
// ============================================================

const ENGINE_NAME = "TRUSTFX Market Structure Engine";
const ENGINE_VERSION = "1.0";

const DEFAULTS = {
    accountBalance: 6000,
    riskPercent: 0.5,

    // Maximum permitted distance between entry and stop-loss.
    // This is in PRICE UNITS, not dollars of account risk.
    // Calibrate separately for the selected symbol/timeframe.
    maxRiskDistance: 10,

    // Reject a retest candle whose range is larger than
    // this multiple of the average recent candle body.
    maxRetestRangeMultiple: 2.5,

    swingStrength: 2,
    sweepLookback: 35,
    displacementLookahead: 10,

    // Must be explicitly supplied for reliable lot sizing.
    // Value = account-currency amount gained/lost per
    // 1.0 price-unit movement for 1.0 lot.
    valuePerPriceUnitPerLot: null,

    // Optional broker-specific volume limits.
    minLot: 0.01,
    maxLot: 100,
    lotStep: 0.01
};

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}

function round(value, decimals = 5) {
    if (!Number.isFinite(value)) return null;

    const factor = 10 ** decimals;

    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function timeOf(candle) {
    return candle.datetime ?? candle.time ?? candle.timestamp ?? null;
}

function normalizeCandles(input) {
    if (!Array.isArray(input)) return [];

    const candles = input
        .map((c, originalIndex) => ({
            originalIndex,
            time: timeOf(c),

            open: num(c.open),
            high: num(c.high),
            low: num(c.low),
            close: num(c.close),

            volume: num(c.volume)
        }))
        .filter(c =>
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close) &&
            c.high >= c.low &&
            c.high >= Math.max(c.open, c.close) &&
            c.low <= Math.min(c.open, c.close)
        );

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

function body(candle) {
    return Math.abs(candle.close - candle.open);
}

function bullish(candle) {
    return candle.close > candle.open;
}

function bearish(candle) {
    return candle.close < candle.open;
}

function averageBody(candles, endIndex, period = 10) {
    const start = Math.max(0, endIndex - period);

    const values = [];

    for (let i = start; i < endIndex; i++) {
        values.push(body(candles[i]));
    }

    if (!values.length) return 0;

    return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function mergeOptions(options = {}) {
    return {
        ...DEFAULTS,
        ...options
    };
}

// ------------------------------------------------------------
// SWINGS
// ------------------------------------------------------------

function detectSwings(candles, strength = 2) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = strength; i < candles.length - strength; i++) {
        const c = candles[i];

        let high = true;
        let low = true;

        for (let j = 1; j <= strength; j++) {
            if (
                candles[i - j].high >= c.high ||
                candles[i + j].high > c.high
            ) {
                high = false;
            }

            if (
                candles[i - j].low <= c.low ||
                candles[i + j].low < c.low
            ) {
                low = false;
            }
        }

        if (high) {
            swingHighs.push({
                index: i,
                time: c.time,
                price: c.high
            });
        }

        if (low) {
            swingLows.push({
                index: i,
                time: c.time,
                price: c.low
            });
        }
    }

    return { swingHighs, swingLows };
}

function trendBefore(swings, index) {
    const highs = swings.swingHighs.filter(s => s.index < index);
    const lows = swings.swingLows.filter(s => s.index < index);

    if (highs.length < 2 || lows.length < 2) return "NEUTRAL";

    const h1 = highs[highs.length - 2].price;
    const h2 = highs[highs.length - 1].price;

    const l1 = lows[lows.length - 2].price;
    const l2 = lows[lows.length - 1].price;

    if (h2 < h1 && l2 < l1) return "BEARISH";
    if (h2 > h1 && l2 > l1) return "BULLISH";

    return "NEUTRAL";
}

function determineTrend(swings) {
    return trendBefore(
        swings,
        Number.POSITIVE_INFINITY
    );
}

// ------------------------------------------------------------
// LIQUIDITY SWEEP
// ------------------------------------------------------------

function detectSweep(candles, swings, lookback) {
    const last = candles.length - 1;
    const start = Math.max(2, last - lookback);

    for (let i = last; i >= start; i--) {
        const c = candles[i];

        const highs = swings.swingHighs.filter(s => s.index < i);
        const lows = swings.swingLows.filter(s => s.index < i);

        const priorHigh = highs.at(-1);
        const priorLow = lows.at(-1);

        if (
            priorLow &&
            c.low < priorLow.price &&
            c.close > priorLow.price
        ) {
            return {
                detected: true,
                direction: "BULLISH",
                type: "SELL_SIDE_SWEEP",

                index: i,
                time: c.time,

                liquidityLevel: priorLow.price,

                sweepLow: c.low,
                sweepHigh: c.high
            };
        }

        if (
            priorHigh &&
            c.high > priorHigh.price &&
            c.close < priorHigh.price
        ) {
            return {
                detected: true,
                direction: "BEARISH",
                type: "BUY_SIDE_SWEEP",

                index: i,
                time: c.time,

                liquidityLevel: priorHigh.price,

                sweepLow: c.low,
                sweepHigh: c.high
            };
        }
    }

    return null;
}

// ------------------------------------------------------------
// DISPLACEMENT
// ------------------------------------------------------------

function detectDisplacement(candles, sweep, lookahead) {
    if (!sweep) return null;

    const end = Math.min(
        candles.length - 1,
        sweep.index + lookahead
    );

    for (let i = sweep.index + 1; i <= end; i++) {
        const c = candles[i];

        const avg = averageBody(candles, i, 10);
        if (avg <= 0) continue;

        const candleBody = body(c);
        const threshold = avg * 1.2;

        const valid =
            sweep.direction === "BULLISH"
                ? bullish(c)
                : bearish(c);

        if (valid && candleBody >= threshold) {
            return {
                detected: true,
                direction: sweep.direction,

                index: i,
                time: c.time,

                body: candleBody,
                averageBody: avg,
                threshold
            };
        }
    }

    return null;
}

// ------------------------------------------------------------
// BOS / CHoCH
// ------------------------------------------------------------

function detectStructureBreak(candles, swings, sweep, displacement) {
    if (!sweep || !displacement) return null;

    const direction = sweep.direction;
    const index = displacement.index;

    const previousTrend = trendBefore(swings, index);

    const candidates = (
        direction === "BULLISH"
            ? swings.swingHighs
            : swings.swingLows
    ).filter(s =>
        s.index < index &&
        s.index > sweep.index - 40
    );

    const levelSwing = candidates.at(-1);

    if (!levelSwing) return null;

    const c = candles[index];

    const broke = direction === "BULLISH"
        ? c.close > levelSwing.price
        : c.close < levelSwing.price;

    if (!broke) return null;

    const bos = previousTrend === direction;

    const choch =
        previousTrend !== "NEUTRAL" &&
        previousTrend !== direction;

    if (!bos && !choch) return null;

    return {
        detected: true,

        direction,
        previousTrend,

        bos,
        choch,

        index,
        time: c.time,

        brokenLevel: levelSwing.price
    };
}

// ------------------------------------------------------------
// FAIR VALUE GAPS
// ------------------------------------------------------------

function detectFVGs(candles, displacement, structureBreak) {
    if (!displacement || !structureBreak) return [];

    const gaps = [];

    for (let i = 2; i < candles.length; i++) {
        if (i <= structureBreak.index) continue;

        const a = candles[i - 2];
        const c = candles[i];

        if (
            displacement.direction === "BULLISH" &&
            a.high < c.low
        ) {
            gaps.push({
                detected: true,
                direction: "BULLISH",

                high: c.low,
                low: a.high,

                index: i,
                time: c.time
            });
        }

        if (
            displacement.direction === "BEARISH" &&
            a.low > c.high
        ) {
            gaps.push({
                detected: true,
                direction: "BEARISH",

                high: a.low,
                low: c.high,

                index: i,
                time: c.time
            });
        }
    }

    return gaps;
}

// ------------------------------------------------------------
// STAGE 3.8: FVG QUALITY + INVALIDATION
// ------------------------------------------------------------

function analyzeFVG(candles, fvg, settings) {
    const lastIndex = candles.length - 1;

    let invalidated = false;
    let firstRetestIndex = null;
    let latestRetestIndex = null;

    for (let i = fvg.index + 1; i <= lastIndex; i++) {
        const c = candles[i];

        if (
            fvg.direction === "BULLISH" &&
            c.close < fvg.low
        ) {
            invalidated = true;
            break;
        }

        if (
            fvg.direction === "BEARISH" &&
            c.close > fvg.high
        ) {
            invalidated = true;
            break;
        }

        const overlaps =
            c.low <= fvg.high &&
            c.high >= fvg.low;

        if (overlaps) {
            if (firstRetestIndex === null) {
                firstRetestIndex = i;
            }

            latestRetestIndex = i;
        }
    }

    const c = candles[lastIndex];

    const overlapsCurrent =
        lastIndex > fvg.index &&
        c.low <= fvg.high &&
        c.high >= fvg.low;

    // Stronger retest:
    // BUY: tests the zone and closes above its upper boundary.
    // SELL: tests the zone and closes below its lower boundary.
    const closesBeyondZone =
        fvg.direction === "BULLISH"
            ? c.close > fvg.high
            : c.close < fvg.low;

    const correctDirection =
        fvg.direction === "BULLISH"
            ? bullish(c)
            : bearish(c);

    const recentAverageBody = averageBody(
        candles,
        lastIndex,
        10
    );

    const currentRange = c.high - c.low;

    const rangeLimit = recentAverageBody > 0
        ? recentAverageBody * settings.maxRetestRangeMultiple
        : 0;

    const candleSizeValid =
        rangeLimit > 0 &&
        currentRange <= rangeLimit;

    const currentRetest =
        !invalidated &&
        overlapsCurrent &&
        closesBeyondZone &&
        correctDirection &&
        candleSizeValid;

    let position = "INSIDE";

    if (c.close > fvg.high) position = "ABOVE";
    if (c.close < fvg.low) position = "BELOW";

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

        quality: {
            overlapsZone: Boolean(overlapsCurrent),
            closesBeyondZone,
            correctDirection,

            currentRange,
            averageBody: recentAverageBody,
            rangeLimit,

            candleSizeValid
        },

        position
    };
}

// ------------------------------------------------------------
// POSITION SIZING
// ------------------------------------------------------------

function calculatePositionSize(
    riskDistance,
    settings
) {
    const balance = num(settings.accountBalance);
    const riskPercent = num(settings.riskPercent);
    const valuePerUnit = num(settings.valuePerPriceUnitPerLot);

    if (
        !Number.isFinite(balance) ||
        balance <= 0 ||
        !Number.isFinite(riskPercent) ||
        riskPercent <= 0 ||
        riskPercent > 100
    ) {
        return {
            calculated: false,
            reason: "Invalid account balance or risk percentage."
        };
    }

    const riskAmount = balance * riskPercent / 100;

    if (
        !Number.isFinite(valuePerUnit) ||
        valuePerUnit <= 0
    ) {
        return {
            calculated: false,
            reason:
                "Provide the broker-specific value per 1.0 price-unit move per 1.0 lot.",
            riskAmount: round(riskAmount, 2),
            lotSize: null
        };
    }

    const rawLots = riskAmount / (
        riskDistance * valuePerUnit
    );

    const step = num(settings.lotStep);

    if (!Number.isFinite(step) || step <= 0) {
        return {
            calculated: false,
            reason: "Invalid broker lot step.",
            riskAmount: round(riskAmount, 2),
            lotSize: null
        };
    }

    // Round DOWN so the calculated volume does not exceed
    // the risk amount because of lot-step rounding.
    const lotSize = Math.floor(rawLots / step) * step;

    if (lotSize < settings.minLot) {
        return {
            calculated: false,
            reason:
                "Calculated lot size is below the broker's minimum lot size.",
            riskAmount: round(riskAmount, 2),
            rawLots: round(rawLots, 4),
            lotSize: null
        };
    }

    if (lotSize > settings.maxLot) {
        return {
            calculated: false,
            reason:
                "Calculated lot size exceeds the configured maximum.",
            riskAmount: round(riskAmount, 2),
            rawLots: round(rawLots, 4),
            lotSize: null
        };
    }

    return {
        calculated: true,

        accountBalance: round(balance, 2),
        riskPercent: round(riskPercent, 3),

        riskAmount: round(riskAmount, 2),

        rawLots: round(rawLots, 4),
        lotSize: round(lotSize, 4),

        valuePerPriceUnitPerLot: round(valuePerUnit, 6)
    };
}

// ------------------------------------------------------------
// TRADE VALIDATION
// ------------------------------------------------------------

function calculateTrade(sweep, displacement, fvg, candles, settings) {
    if (
        !sweep ||
        !displacement ||
        !fvg ||
        fvg.invalidated ||
        !fvg.currentRetest
    ) {
        return null;
    }

    const current = candles.at(-1);

    const entry = current.close;

    // Provisional buffer. Calibrate this to the symbol's
    // tick size and broker contract specifications.
    const buffer = Math.abs(entry) >= 100
        ? 0.10
        : 0.0001;

    const stopLoss = sweep.direction === "BULLISH"
        ? sweep.sweepLow - buffer
        : sweep.sweepHigh + buffer;

    const riskDistance = sweep.direction === "BULLISH"
        ? entry - stopLoss
        : stopLoss - entry;

    if (
        !Number.isFinite(riskDistance) ||
        riskDistance <= 0
    ) {
        return {
            confirmed: false,
            reason: "Invalid stop-loss distance."
        };
    }

    if (riskDistance > settings.maxRiskDistance) {
        return {
            confirmed: false,
            reason: "Stop-loss distance exceeds the configured maximum.",
            entry: round(entry),
            stopLoss: round(stopLoss),
            riskDistance: round(riskDistance),
            maxRiskDistance: settings.maxRiskDistance
        };
    }

    const multiplier = sweep.direction === "BULLISH" ? 1 : -1;

    const takeProfit1 = entry + multiplier * riskDistance * 1.5;
    const takeProfit2 = entry + multiplier * riskDistance * 2;
    const takeProfit3 = entry + multiplier * riskDistance * 3;

    const positionSize = calculatePositionSize(
        riskDistance,
        settings
    );

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

        positionSize
    };
}

// ------------------------------------------------------------
// MAIN ANALYSIS
// ------------------------------------------------------------

export function analyzeMarketStructure(inputCandles, options = {}) {
    const settings = mergeOptions(options);

    const candles = normalizeCandles(inputCandles);

    const symbol = settings.symbol ?? "UNKNOWN";
    const interval = settings.interval ?? "15min";

    if (candles.length < 20) {
        return {
            status: "WAIT",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            symbol,
            interval,
            candleCount: candles.length,

            analysis: {
                status: "WAIT",
                reason: "At least 20 valid candles are required."
            }
        };
    }

    const current = candles.at(-1);

    const swings = detectSwings(
        candles,
        settings.swingStrength
    );

    const trend = determineTrend(swings);

    const highs = swings.swingHighs;
    const lows = swings.swingLows;

    const latestHigh = highs.at(-1);
    const previousHigh = highs.at(-2);

    const latestLow = lows.at(-1);
    const previousLow = lows.at(-2);

    const sweep = detectSweep(
        candles,
        swings,
        settings.sweepLookback
    );

    const displacement = detectDisplacement(
        candles,
        sweep,
        settings.displacementLookahead
    );

    const structureBreak = detectStructureBreak(
        candles,
        swings,
        sweep,
        displacement
    );

    const gaps = detectFVGs(
        candles,
        displacement,
        structureBreak
    );

    let fvg = null;

    // Prefer the most recent valid FVG. Continue checking
    // older gaps only if the newer gap has been invalidated.
    for (let i = gaps.length - 1; i >= 0; i--) {
        const candidate = analyzeFVG(
            candles,
            gaps[i],
            settings
        );

        if (!candidate.invalidated) {
            fvg = candidate;

            if (candidate.currentRetest) break;
        }
    }

    const sweepConfirmed = Boolean(sweep);

    const displacementConfirmed = Boolean(
        sweep &&
        displacement &&
        sweep.direction === displacement.direction
    );

    const structureBreakConfirmed = Boolean(
        structureBreak &&
        (structureBreak.bos || structureBreak.choch)
    );

    const fvgConfirmed = Boolean(
        fvg &&
        sweep &&
        fvg.direction === sweep.direction
    );

    const fvgRetest = Boolean(fvg?.currentRetest);

    const fvgInvalidated = Boolean(fvg?.invalidated);

    let trade = null;

    if (
        sweepConfirmed &&
        displacementConfirmed &&
        structureBreakConfirmed &&
        fvgConfirmed &&
        fvgRetest &&
        !fvgInvalidated
    ) {
        trade = calculateTrade(
            sweep,
            displacement,
            fvg,
            candles,
            settings
        );
    }

    const entryConfirmed = Boolean(
        trade?.confirmed &&
        trade?.positionSize
    );

    const entryStatus = entryConfirmed
        ? trade.signal
        : "WAIT";

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
            structureBreak.direction === sweep?.direction)
    ];

    const score = confirmations.filter(Boolean).length;

    let invalidReason = null;

    if (!sweepConfirmed) {
        invalidReason = "No confirmed liquidity sweep.";
    } else if (!displacementConfirmed) {
        invalidReason = "Waiting for displacement.";
    } else if (!structureBreakConfirmed) {
        invalidReason = "Waiting for valid BOS or CHoCH.";
    } else if (!fvgConfirmed) {
        invalidReason = "Waiting for a valid directional FVG.";
    } else if (fvgInvalidated) {
        invalidReason = "FVG invalidated.";
    } else if (!fvgRetest) {
        invalidReason = "Waiting for a quality FVG retest.";
    } else if (trade && !trade.confirmed) {
        invalidReason = trade.reason;
    } else if (!entryConfirmed) {
        invalidReason =
            trade?.positionSize?.reason ??
            "Position sizing could not be validated.";
    }

    const positionSize = trade?.positionSize ?? null;

    const range = current.high - current.low;

    return {
        status: entryStatus,

        engine: ENGINE_NAME,
        version: ENGINE_VERSION,

        symbol,
        interval,

        candleCount: candles.length,

        analysis: {
            status: entryStatus,

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

            swingHigh: round(latestHigh?.price),
            swingLow: round(latestLow?.price),

            previousSwingHigh: round(previousHigh?.price),
            previousSwingLow: round(previousLow?.price),

            lowerHigh: Boolean(
                latestHigh &&
                previousHigh &&
                latestHigh.price < previousHigh.price
            ),

            lowerLow: Boolean(
                latestLow &&
                previousLow &&
                latestLow.price < previousLow.price
            ),

            higherHigh: Boolean(
                latestHigh &&
                previousHigh &&
                latestHigh.price > previousHigh.price
            ),

            higherLow: Boolean(
                latestLow &&
                previousLow &&
                latestLow.price > previousLow.price
            ),

            lastSwingHighTime: latestHigh?.time ?? null,
            lastSwingLowTime: latestLow?.time ?? null,

            liquidity: {
                status: sweep
                    ? `CONFIRMED ${sweep.type.replaceAll("_", "-")}`
                    : "NO CONFIRMED SWEEP",

                detected: sweepConfirmed,

                sweepDirection: sweep?.direction ?? "NONE",

                rejection: Boolean(sweep),

                lowSweep: Boolean(
                    sweep?.type === "SELL_SIDE_SWEEP"
                ),

                highSweep: Boolean(
                    sweep?.type === "BUY_SIDE_SWEEP"
                ),

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

                linkedToSweep: Boolean(displacement)
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

                    quality: fvg.quality,

                    position: fvg.position
                }
                : {
                    detected: false,
                    direction: "NONE",

                    high: null,
                    low: null,

                    invalidated: false,

                    retest: false,
                    currentRetest: false,

                    quality: null,
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

                price: entryConfirmed ? trade.price : null,

                stopLoss: entryConfirmed
                    ? trade.stopLoss
                    : null,

                takeProfit1: entryConfirmed
                    ? trade.takeProfit1
                    : null,

                takeProfit2: entryConfirmed
                    ? trade.takeProfit2
                    : null,

                takeProfit3: entryConfirmed
                    ? trade.takeProfit3
                    : null,

                riskDistance: trade?.riskDistance ?? null,

                riskReward: entryConfirmed
                    ? trade.riskReward
                    : null,

                positionSize
            },

            riskFilter: {
                accountBalance: settings.accountBalance,
                riskPercent: settings.riskPercent,

                maxRiskDistance: settings.maxRiskDistance,

                maximumRetestRangeMultiple:
                    settings.maxRetestRangeMultiple,

                riskDistance: trade?.riskDistance ?? null,

                accepted: entryConfirmed,

                reason: invalidReason
            },

            confirmationScore: {
                score,
                maximum: 8,

                percentage: Math.round(score / 8 * 100),

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
                        detected: false
                    },

                displacement: displacement
                    ? {
                        detected: true,
                        index: displacement.index,
                        time: displacement.time,
                        direction: displacement.direction
                    }
                    : {
                        detected: false
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
                        detected: false
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
                        detected: false
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
                    fvg &&
                    sweep.index < displacement.index &&
                    displacement.index <= structureBreak.index &&
                    structureBreak.index < fvg.index
                ),

                invalidReason,

                complete: entryConfirmed
            },

            candleMetrics: {
                upperWick: round(
                    current.high - Math.max(current.open, current.close)
                ),

                lowerWick: round(
                    Math.min(current.open, current.close) - current.low
                ),

                range: round(range),

                body: round(body(current))
            }
        }
    };
}

export default analyzeMarketStructure;
