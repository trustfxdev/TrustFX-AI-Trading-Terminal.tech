// ============================================================
// TRUSTFX MARKET STRUCTURE ENGINE
// Stage 3.9 — Structure, Liquidity, FVG, Risk and Confirmation
// ============================================================

const ENGINE_NAME = "TRUSTFX Market Structure Engine";
const ENGINE_VERSION = "3.9";

const DEFAULTS = {
  accountBalance: 6000,
  riskPercent: 0.5,

  maxRiskDistance: 10,
  maximumRetestRangeMultiple: 2.5,

  // MUST be configured from the broker's actual contract specs.
  // Do not guess this value.
  valuePerPriceUnitPerLot: null,

  minLot: 0.01,
  lotStep: 0.01,
  maxLot: null,

  swingStrength: 2,
  sweepLookback: 35,
  displacementLookback: 10,
  displacementMultiplier: 1.2,
  fvgLookback: 12,

  stopBuffer: null,
  minRiskDistance: 0.0000001
};

// ============================================================
// BASIC HELPERS
// ============================================================

function round(value, decimals = 5) {
  if (!Number.isFinite(value)) return null;

  const factor = 10 ** decimals;

  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values) {
  if (!values.length) return 0;

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

function validNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeCandles(candles) {
  if (!Array.isArray(candles)) return [];

  const parsed = candles.map((candle, originalIndex) => ({
    time: candle.datetime ?? candle.time ?? null,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    originalIndex
  }));

  const valid = parsed.filter(candle =>
    validNumber(candle.open) &&
    validNumber(candle.high) &&
    validNumber(candle.low) &&
    validNumber(candle.close) &&
    candle.high >= candle.low &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close)
  );

  // Twelve Data normally returns newest first.
  // Sort chronologically when timestamps can be parsed.
  const allTimesValid = valid.every(candle =>
    candle.time !== null &&
    Number.isFinite(Date.parse(candle.time))
  );

  if (allTimesValid) {
    valid.sort((a, b) =>
      Date.parse(a.time) - Date.parse(b.time)
    );
  } else {
    valid.sort((a, b) =>
      a.originalIndex - b.originalIndex
    );

    // Preserve the Twelve Data newest-first assumption.
    valid.reverse();
  }

  return valid.map(({ originalIndex, ...candle }) => candle);
}

// ============================================================
// SWING DETECTION
// ============================================================

function detectSwings(data, strength = 2) {
  const swings = [];

  for (
    let i = strength;
    i < data.length - strength;
    i++
  ) {
    const candle = data[i];

    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= strength; j++) {
      if (
        candle.high <= data[i - j].high ||
        candle.high <= data[i + j].high
      ) {
        isHigh = false;
      }

      if (
        candle.low >= data[i - j].low ||
        candle.low >= data[i + j].low
      ) {
        isLow = false;
      }
    }

    if (isHigh) {
      swings.push({
        type: "HIGH",
        price: candle.high,
        time: candle.time,
        index: i
      });
    }

    if (isLow) {
      swings.push({
        type: "LOW",
        price: candle.low,
        time: candle.time,
        index: i
      });
    }
  }

  return swings;
}

// ============================================================
// STRUCTURAL TREND
// ============================================================

function getStructure(data, swings, currentIndex) {
  const confirmed = swings.filter(
    swing => swing.index < currentIndex
  );

  const highs = confirmed
    .filter(swing => swing.type === "HIGH")
    .slice(-5);

  const lows = confirmed
    .filter(swing => swing.type === "LOW")
    .slice(-5);

  if (highs.length < 2 || lows.length < 2) {
    return {
      trend: "NEUTRAL",
      structure: "WAITING",
      highs,
      lows,
      higherHigh: false,
      higherLow: false,
      lowerHigh: false,
      lowerLow: false
    };
  }

  const previousHigh = highs[highs.length - 2];
  const latestHigh = highs[highs.length - 1];

  const previousLow = lows[lows.length - 2];
  const latestLow = lows[lows.length - 1];

  const higherHigh = latestHigh.price > previousHigh.price;
  const higherLow = latestLow.price > previousLow.price;

  const lowerHigh = latestHigh.price < previousHigh.price;
  const lowerLow = latestLow.price < previousLow.price;

  let trend = "NEUTRAL";

  if (higherHigh && higherLow) {
    trend = "BULLISH";
  } else if (lowerHigh && lowerLow) {
    trend = "BEARISH";
  }

  return {
    trend,

    structure:
      trend === "BULLISH"
        ? "HH + HL"
        : trend === "BEARISH"
        ? "LH + LL"
        : "MIXED",

    highs,
    lows,

    previousHigh,
    latestHigh,
    previousLow,
    latestLow,

    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow
  };
}

// ============================================================
// BOS / CHOCH DETECTION
// Uses a candle after the sweep/displacement sequence when one
// is available. Does not automatically label displacement as
// the structure break.
// ============================================================

function detectStructureBreak(
  data,
  swings,
  sweep,
  displacement,
  currentIndex
) {
  if (!sweep || !displacement) return null;

  const startIndex = displacement.index + 1;

  if (startIndex > currentIndex) return null;

  const structureBefore = getStructure(
    data,
    swings,
    displacement.index
  );

  const previousTrend = structureBefore.trend;

  if (previousTrend === "NEUTRAL") {
    return null;
  }

  for (let i = startIndex; i <= currentIndex; i++) {
    const candle = data[i];

    const confirmedSwings = swings.filter(
      swing => swing.index < i
    );

    const highs = confirmedSwings
      .filter(swing => swing.type === "HIGH");

    const lows = confirmedSwings
      .filter(swing => swing.type === "LOW");

    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];

    if (
      displacement.direction === "BULLISH" &&
      lastHigh &&
      candle.close > lastHigh.price
    ) {
      return {
        detected: true,
        direction: "BULLISH",
        previousTrend,
        bos: previousTrend === "BULLISH",
        choch: previousTrend === "BEARISH",
        index: i,
        time: candle.time,
        brokenLevel: lastHigh.price
      };
    }

    if (
      displacement.direction === "BEARISH" &&
      lastLow &&
      candle.close < lastLow.price
    ) {
      return {
        detected: true,
        direction: "BEARISH",
        previousTrend,
        bos: previousTrend === "BEARISH",
        choch: previousTrend === "BULLISH",
        index: i,
        time: candle.time,
        brokenLevel: lastLow.price
      };
    }
  }

  return null;
}

// ============================================================
// LIQUIDITY SWEEP DETECTION
// ============================================================

function detectSweep(data, swings, currentIndex, lookback = 35) {
  const firstIndex = Math.max(0, currentIndex - lookback);

  const candidates = swings.filter(swing =>
    swing.index >= firstIndex &&
    swing.index < currentIndex
  );

  for (let i = currentIndex; i >= firstIndex; i--) {
    const candle = data[i];

    const previousHighs = candidates.filter(
      swing =>
        swing.type === "HIGH" &&
        swing.index < i
    );

    const previousLows = candidates.filter(
      swing =>
        swing.type === "LOW" &&
        swing.index < i
    );

    const latestHigh = previousHighs[previousHighs.length - 1];
    const latestLow = previousLows[previousLows.length - 1];

    // Price sweeps a previous low and closes back above it.
    if (
      latestLow &&
      candle.low < latestLow.price &&
      candle.close > latestLow.price
    ) {
      return {
        detected: true,
        direction: "BULLISH",
        status: "CONFIRMED SELL-SIDE-SWEEP",
        rejection: true,
        lowSweep: true,
        highSweep: false,
        liquidityLevel: latestLow.price,
        sweepLow: candle.low,
        sweepHigh: candle.high,
        index: i,
        time: candle.time
      };
    }

    // Price sweeps a previous high and closes back below it.
    if (
      latestHigh &&
      candle.high > latestHigh.price &&
      candle.close < latestHigh.price
    ) {
      return {
        detected: true,
        direction: "BEARISH",
        status: "CONFIRMED BUY-SIDE-SWEEP",
        rejection: true,
        lowSweep: false,
        highSweep: true,
        liquidityLevel: latestHigh.price,
        sweepLow: candle.low,
        sweepHigh: candle.high,
        index: i,
        time: candle.time
      };
    }
  }

  return {
    detected: false,
    direction: "NONE",
    status: "NO CONFIRMED SWEEP",
    rejection: false,
    lowSweep: false,
    highSweep: false
  };
}

// ============================================================
// DISPLACEMENT DETECTION
// ============================================================

function detectDisplacement(
  data,
  sweep,
  currentIndex,
  lookback = 10,
  multiplier = 1.2
) {
  if (!sweep?.detected) {
    return {
      detected: false,
      direction: "NONE",
      linkedToSweep: false
    };
  }

  const firstIndex = Math.max(
    sweep.index + 1,
    currentIndex - lookback + 1
  );

  for (let i = currentIndex; i >= firstIndex; i--) {
    const candle = data[i];

    const body = Math.abs(candle.close - candle.open);

    const recentBodies = data
      .slice(Math.max(0, i - 10), i)
      .map(c => Math.abs(c.close - c.open));

    const averageBody = average(recentBodies);

    if (averageBody <= 0) continue;

    const threshold = averageBody * multiplier;

    const bullish = candle.close > candle.open;
    const bearish = candle.close < candle.open;

    if (
      sweep.direction === "BULLISH" &&
      bullish &&
      body >= threshold
    ) {
      return {
        detected: true,
        direction: "BULLISH",
        index: i,
        time: candle.time,
        body,
        averageBody,
        threshold,
        linkedToSweep: true
      };
    }

    if (
      sweep.direction === "BEARISH" &&
      bearish &&
      body >= threshold
    ) {
      return {
        detected: true,
        direction: "BEARISH",
        index: i,
        time: candle.time,
        body,
        averageBody,
        threshold,
        linkedToSweep: true
      };
    }
  }

  return {
    detected: false,
    direction: "NONE",
    linkedToSweep: false
  };
}

// ============================================================
// FAIR VALUE GAP DETECTION
// Three-candle imbalance.
// ============================================================

function detectFvg(data, structureBreak, currentIndex, lookback = 12) {
  if (!structureBreak?.detected) {
    return {
      detected: false,
      direction: "NONE",
      invalidated: false
    };
  }

  const firstIndex = Math.max(
    2,
    structureBreak.index + 1
  );

  const lastIndex = Math.min(
    currentIndex,
    structureBreak.index + lookback
  );

  for (let i = lastIndex; i >= firstIndex; i--) {
    const candle1 = data[i - 2];
    const candle3 = data[i];

    if (
      structureBreak.direction === "BULLISH" &&
      candle3.low > candle1.high
    ) {
      return {
        detected: true,
        direction: "BULLISH",
        high: candle3.low,
        low: candle1.high,
        index: i,
        time: candle3.time,
        invalidated: false
      };
    }

    if (
      structureBreak.direction === "BEARISH" &&
      candle3.high < candle1.low
    ) {
      return {
        detected: true,
        direction: "BEARISH",
        high: candle1.low,
        low: candle3.high,
        index: i,
        time: candle3.time,
        invalidated: false
      };
    }
  }

  return {
    detected: false,
    direction: "NONE",
    invalidated: false
  };
}

// ============================================================
// FVG INVALIDATION
// ============================================================

function checkFvgInvalidation(data, fvg, currentIndex) {
  if (!fvg?.detected) return false;

  for (
    let i = fvg.index + 1;
    i <= currentIndex;
    i++
  ) {
    const candle = data[i];

    if (
      fvg.direction === "BULLISH" &&
      candle.close < fvg.low
    ) {
      return true;
    }

    if (
      fvg.direction === "BEARISH" &&
      candle.close > fvg.high
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================
// FVG RETEST QUALITY
// ============================================================

function analyzeRetest(
  data,
  fvg,
  currentIndex,
  maxRangeMultiple = 2.5
) {
  if (!fvg?.detected) {
    return {
      detected: false,
      currentCandle: false,
      valid: false
    };
  }

  const candle = data[currentIndex];

  const recentBodies = data
    .slice(Math.max(0, currentIndex - 10), currentIndex)
    .map(c => Math.abs(c.close - c.open));

  const averageBody = average(recentBodies);

  const range = candle.high - candle.low;

  const rangeLimit = averageBody * maxRangeMultiple;

  const overlapsZone =
    candle.low <= fvg.high &&
    candle.high >= fvg.low;

  const closesBeyondZone =
    fvg.direction === "BULLISH"
      ? candle.close > fvg.high
      : candle.close < fvg.low;

  const correctDirection =
    fvg.direction === "BULLISH"
      ? candle.close > candle.open
      : candle.close < candle.open;

  const candleSizeValid =
    averageBody > 0 &&
    range <= rangeLimit;

  const valid =
    overlapsZone &&
    closesBeyondZone &&
    correctDirection &&
    candleSizeValid;

  let position = "INSIDE";

  if (candle.close > fvg.high) {
    position = "ABOVE";
  } else if (candle.close < fvg.low) {
    position = "BELOW";
  }

  let firstRetestIndex = null;
  let latestRetestIndex = null;

  for (
    let i = fvg.index + 1;
    i <= currentIndex;
    i++
  ) {
    const historicalCandle = data[i];

    const overlaps =
      historicalCandle.low <= fvg.high &&
      historicalCandle.high >= fvg.low;

    if (overlaps) {
      if (firstRetestIndex === null) {
        firstRetestIndex = i;
      }

      latestRetestIndex = i;
    }
  }

  return {
    detected: latestRetestIndex !== null,
    firstRetestIndex,
    latestRetestIndex,
    currentCandle:
      latestRetestIndex === currentIndex,
    valid,

    quality: {
      overlapsZone,
      closesBeyondZone,
      correctDirection,
      currentRange: range,
      averageBody,
      rangeLimit,
      candleSizeValid,
      position
    }
  };
}

// ============================================================
// POSITION SIZE
// Requires broker-specific value per price unit per lot.
// ============================================================

function calculatePositionSize({
  accountBalance,
  riskPercent,
  riskDistance,
  valuePerPriceUnitPerLot,
  minLot,
  lotStep,
  maxLot
}) {
  const riskAmount =
    accountBalance * (riskPercent / 100);

  if (
    !Number.isFinite(valuePerPriceUnitPerLot) ||
    valuePerPriceUnitPerLot <= 0
  ) {
    return {
      calculated: false,
      lots: null,
      riskAmount: round(riskAmount, 2),
      reason:
        "Broker-specific valuePerPriceUnitPerLot is not configured."
    };
  }

  if (
    !Number.isFinite(riskDistance) ||
    riskDistance <= 0
  ) {
    return {
      calculated: false,
      lots: null,
      riskAmount: round(riskAmount, 2),
      reason: "Invalid risk distance."
    };
  }

  const rawLots =
    riskAmount /
    (riskDistance * valuePerPriceUnitPerLot);

  if (rawLots < minLot) {
    return {
      calculated: false,
      lots: null,
      riskAmount: round(riskAmount, 2),
      rawLots: round(rawLots, 4),
      reason:
        "Calculated lot size is below the broker minimum."
    };
  }

  const steppedLots =
    Math.floor(rawLots / lotStep) * lotStep;

  const lots = Number(
    Math.min(
      maxLot ?? steppedLots,
      steppedLots
    ).toFixed(4)
  );

  if (lots < minLot) {
    return {
      calculated: false,
      lots: null,
      riskAmount: round(riskAmount, 2),
      reason: "Lot size is below minimum after rounding."
    };
  }

  return {
    calculated: true,
    lots,
    riskAmount: round(riskAmount, 2),
    riskPerLot: round(
      riskDistance * valuePerPriceUnitPerLot,
      4
    ),
    reason: null
  };
}

// ============================================================
// BASE RESPONSE
// ============================================================

function baseResult({
  symbol,
  interval,
  candleCount,
  trend = "NEUTRAL",
  structure = "WAITING",
  currentPrice = null
}) {
  return {
    status: "WAIT",
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,

    symbol,
    interval,
    candleCount,

    candleOrder: "ASCENDING",

    trend,
    structure,

    bos: false,
    bosDirection: "NONE",

    choch: false,
    chochDirection: "NONE",

    currentPrice,

    liquidity: {
      detected: false,
      status: "NO CONFIRMED SWEEP",
      direction: "NONE"
    },

    displacement: {
      detected: false,
      direction: "NONE"
    },

    fvg: {
      detected: false,
      direction: "NONE",
      invalidated: false
    },

    retest: {
      detected: false,
      currentCandle: false,
      valid: false
    },

    setup: {
      status: "WAITING",
      sweepConfirmed: false,
      displacementConfirmed: false,
      structureBreakConfirmed: false,
      fvgConfirmed: false,
      fvgRetest: false,
      fvgInvalidated: false
    },

    entry: {
      status: "WAIT",
      confirmed: false,
      direction: "NONE",
      price: null,
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null,
      riskDistance: null,
      riskReward: null,
      positionSize: null
    },

    riskFilter: {
      accountBalance: DEFAULTS.accountBalance,
      riskPercent: DEFAULTS.riskPercent,
      maxRiskDistance: DEFAULTS.maxRiskDistance,
      accepted: false,
      reason: "Setup not complete."
    },

    confirmationScore: {
      score: 0,
      maximum: 8,
      percentage: 0,
      validThreshold: false
    },

    sequence: {
      validOrder: false,
      complete: false
    }
  };
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

export function analyzeMarketStructure(
  candles,
  options = {}
) {
  const config = {
    ...DEFAULTS,
    ...options
  };

  const symbol = config.symbol || "UNKNOWN";
  const interval = config.interval || "unknown";

  const data = normalizeCandles(candles);

  if (data.length < 30) {
    const result = baseResult({
      symbol,
      interval,
      candleCount: data.length
    });

    result.message = "Not enough valid candle data.";

    return result;
  }

  const currentIndex = data.length - 1;
  const current = data[currentIndex];

  const swings = detectSwings(
    data,
    config.swingStrength
  );

  const structure = getStructure(
    data,
    swings,
    currentIndex
  );

  const result = baseResult({
    symbol,
    interval,
    candleCount: data.length,
    trend: structure.trend,
    structure: structure.structure,
    currentPrice: current.close
  });

  if (
    structure.highs.length < 2 ||
    structure.lows.length < 2
  ) {
    result.message =
      "Waiting for confirmed swing structure.";

    return result;
  }

  result.swingHigh = structure.latestHigh.price;
  result.swingLow = structure.latestLow.price;

  result.previousSwingHigh =
    structure.previousHigh.price;

  result.previousSwingLow =
    structure.previousLow.price;

  result.higherHigh = structure.higherHigh;
  result.higherLow = structure.higherLow;
  result.lowerHigh = structure.lowerHigh;
  result.lowerLow = structure.lowerLow;

  result.lastSwingHighTime =
    structure.latestHigh.time;

  result.lastSwingLowTime =
    structure.latestLow.time;

  // ----------------------------------------------------------
  // Detect the most recent liquidity sweep.
  // ----------------------------------------------------------

  const sweep = detectSweep(
    data,
    swings,
    currentIndex,
    config.sweepLookback
  );

  result.liquidity = sweep;

  // ----------------------------------------------------------
  // Detect displacement after the sweep.
  // ----------------------------------------------------------

  const displacement = detectDisplacement(
    data,
    sweep,
    currentIndex,
    config.displacementLookback,
    config.displacementMultiplier
  );

  result.displacement = displacement;

  // ----------------------------------------------------------
  // Require a later, separate structure break.
  // ----------------------------------------------------------

  const structureBreak = detectStructureBreak(
    data,
    swings,
    sweep,
    displacement,
    currentIndex
  );

  if (structureBreak) {
    result.bos = structureBreak.bos;
    result.bosDirection =
      structureBreak.bos
        ? structureBreak.direction
        : "NONE";

    result.choch = structureBreak.choch;

    result.chochDirection =
      structureBreak.choch
        ? structureBreak.direction
        : "NONE";
  }

  // ----------------------------------------------------------
  // Detect FVG only after the separate structure break.
  // ----------------------------------------------------------

  const fvg = detectFvg(
    data,
    structureBreak,
    currentIndex,
    config.fvgLookback
  );

  if (fvg.detected) {
    fvg.invalidated = checkFvgInvalidation(
      data,
      fvg,
      currentIndex
    );
  }

  result.fvg = fvg;

  // ----------------------------------------------------------
  // Current-candle retest quality.
  // ----------------------------------------------------------

  const retest = analyzeRetest(
    data,
    fvg,
    currentIndex,
    config.maximumRetestRangeMultiple
  );

  result.retest = retest;

  // ----------------------------------------------------------
  // Confirm chronological sequence.
  // ----------------------------------------------------------

  const validOrder = Boolean(
    sweep.detected &&
    displacement.detected &&
    structureBreak?.detected &&
    fvg.detected &&
    sweep.index < displacement.index &&
    displacement.index < structureBreak.index &&
    structureBreak.index < fvg.index &&
    fvg.index < currentIndex
  );

  const complete = Boolean(
    validOrder &&
    retest.currentCandle &&
    retest.valid &&
    !fvg.invalidated
  );

  result.sequence = {
    sweep: {
      detected: sweep.detected,
      index: sweep.index ?? null,
      time: sweep.time ?? null,
      direction: sweep.direction,
      liquidityLevel: sweep.liquidityLevel ?? null,
      sweepLow: sweep.sweepLow ?? null,
      sweepHigh: sweep.sweepHigh ?? null
    },

    displacement: {
      detected: displacement.detected,
      index: displacement.index ?? null,
      time: displacement.time ?? null,
      direction: displacement.direction
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
          brokenLevel: structureBreak.brokenLevel
        }
      : {
          detected: false
        },

    fvg: {
      detected: fvg.detected,
      index: fvg.index ?? null,
      time: fvg.time ?? null,
      direction: fvg.direction,
      high: fvg.high ?? null,
      low: fvg.low ?? null,
      invalidated: fvg.invalidated
    },

    retest: {
      detected: retest.detected,
      currentCandle: retest.currentCandle,
      index: retest.latestRetestIndex ?? null
    },

    validOrder,
    complete
  };

  // ----------------------------------------------------------
  // Setup status.
  // ----------------------------------------------------------

  result.setup = {
    status: complete ? "READY_FOR_RISK_CHECK" : "WAITING",

    sweepConfirmed: sweep.detected,

    displacementConfirmed:
      displacement.detected,

    structureBreakConfirmed:
      Boolean(structureBreak?.detected),

    fvgConfirmed: fvg.detected,

    fvgRetest: complete,

    fvgInvalidated: fvg.invalidated
  };

  // ----------------------------------------------------------
  // Confirmation score.
  // ----------------------------------------------------------

  const checks = [
    sweep.detected,
    displacement.detected,
    Boolean(structureBreak?.detected),
    fvg.detected,
    !fvg.invalidated,
    retest.currentCandle,
    retest.valid,
    validOrder
  ];

  const score = checks.filter(Boolean).length;

  result.confirmationScore = {
    score,
    maximum: checks.length,
    percentage: Math.round(
      (score / checks.length) * 100
    ),
    validThreshold: score === checks.length
  };

  // ----------------------------------------------------------
  // Entry and risk checks.
  // ----------------------------------------------------------

  if (!complete) {
    result.riskFilter = {
      accountBalance: config.accountBalance,
      riskPercent: config.riskPercent,
      maxRiskDistance: config.maxRiskDistance,
      accepted: false,
      reason: !sweep.detected
        ? "Waiting for a liquidity sweep."
        : !displacement.detected
        ? "Waiting for displacement."
        : !structureBreak?.detected
        ? "Waiting for a separate structure break."
        : !fvg.detected
        ? "Waiting for a fair value gap."
        : fvg.invalidated
        ? "The fair value gap has been invalidated."
        : !retest.currentCandle
        ? "Waiting for a current-candle FVG retest."
        : "Waiting for a quality FVG retest."
    };

    result.status = "WAIT";

    return result;
  }

  const entryDirection = fvg.direction;
  const entryPrice = current.close;

  let stopBuffer = config.stopBuffer;

  if (!Number.isFinite(stopBuffer)) {
    stopBuffer = entryPrice >= 100 ? 0.1 : 0.0001;
  }

  const stopLoss =
    entryDirection === "BULLISH"
      ? sweep.sweepLow - stopBuffer
      : sweep.sweepHigh + stopBuffer;

  const riskDistance = Math.abs(
    entryPrice - stopLoss
  );

  if (
    riskDistance < config.minRiskDistance ||
    riskDistance > config.maxRiskDistance
  ) {
    result.riskFilter = {
      accountBalance: config.accountBalance,
      riskPercent: config.riskPercent,
      maxRiskDistance: config.maxRiskDistance,
      riskDistance: round(riskDistance, 5),
      accepted: false,
      reason: "Risk distance is outside permitted limits."
    };

    return result;
  }

  const positionSize = calculatePositionSize({
    accountBalance: config.accountBalance,
    riskPercent: config.riskPercent,
    riskDistance,
    valuePerPriceUnitPerLot:
      config.valuePerPriceUnitPerLot,
    minLot: config.minLot,
    lotStep: config.lotStep,
    maxLot: config.maxLot
  });

  if (!positionSize.calculated) {
    result.riskFilter = {
      accountBalance: config.accountBalance,
      riskPercent: config.riskPercent,
      maxRiskDistance: config.maxRiskDistance,
      riskDistance: round(riskDistance, 5),
      accepted: false,
      reason: positionSize.reason
    };

    result.entry.positionSize = positionSize;

    return result;
  }

  const riskReward = [1.5, 2, 3];

  const targets = riskReward.map(multiplier =>
    entryDirection === "BULLISH"
      ? entryPrice + riskDistance * multiplier
      : entryPrice - riskDistance * multiplier
  );

  result.entry = {
    status: "CONFIRMED",
    confirmed: true,
    direction: entryDirection,
    price: round(entryPrice),
    stopLoss: round(stopLoss),
    takeProfit1: round(targets[0]),
    takeProfit2: round(targets[1]),
    takeProfit3: round(targets[2]),
    riskDistance: round(riskDistance),
    riskReward,
    positionSize
  };

  result.riskFilter = {
    accountBalance: config.accountBalance,
    riskPercent: config.riskPercent,
    maxRiskDistance: config.maxRiskDistance,
    riskDistance: round(riskDistance),
    accepted: true,
    reason: "All configured checks passed."
  };

  result.status = "CONFIRMED";

  return result;
}

export default analyzeMarketStructure;
