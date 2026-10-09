/**
 * TRUSTFX Market Structure Engine — Stage 3.8
 *
 * Analysis-only engine. It does not place trades.
 *
 * A signal is confirmed only when the complete sequence is valid:
 * Liquidity Sweep -> Displacement -> Structure Break -> FVG
 * -> Current-Candle Retest -> Validated Position Size.
 */

const ENGINE_NAME = 'TRUSTFX Market Structure Engine';
const ENGINE_VERSION = '1.0';

const DEFAULTS = {
  accountBalance: 6000,
  riskPercent: 0.5,
  maxRiskDistance: 10,
  maximumRetestRangeMultiple: 2.5,

  // Must be configured for the exact broker and trading symbol.
  // Never guess this value.
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
  minRiskDistance: 0.0000001,
};

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 5) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function candleTime(candle) {
  const raw =
    candle?.datetime ??
    candle?.time ??
    candle?.timestamp ??
    candle?.date;

  if (raw === undefined || raw === null) return null;

  const ms =
    typeof raw === 'number'
      ? raw < 1e12
        ? raw * 1000
        : raw
      : Date.parse(raw);

  return Number.isFinite(ms) ? ms : null;
}

function formatTime(candle) {
  const ms = candleTime(candle);

  if (ms === null) {
    return (
      candle?.datetime ??
      candle?.time ??
      candle?.timestamp ??
      null
    );
  }

  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

/**
 * Normalize candle data and arrange it chronologically.
 */
function normalizeCandles(input) {
  if (!Array.isArray(input)) return [];

  const normalized = input
    .map((c, originalIndex) => {
      const open = num(c?.open);
      const high = num(c?.high);
      const low = num(c?.low);
      const close = num(c?.close);

      return {
        open,
        high,
        low,
        close,
        volume: num(c?.volume, 0),

        time:
          c?.datetime ??
          c?.time ??
          c?.timestamp ??
          c?.date ??
          null,

        _timeMs: candleTime(c),
        _originalIndex: originalIndex,
      };
    })
    .filter(
      c =>
        [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
        c.high >= c.low &&
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close)
    );

  normalized.sort((a, b) => {
    if (a._timeMs !== null && b._timeMs !== null) {
      return a._timeMs - b._timeMs;
    }

    if (a._timeMs !== null) return -1;
    if (b._timeMs !== null) return 1;

    return a._originalIndex - b._originalIndex;
  });

  return normalized;
}

function average(values) {
  const valid = values.filter(Number.isFinite);

  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : 0;
}

function candleBody(c) {
  return Math.abs(c.close - c.open);
}

function candleRange(c) {
  return c.high - c.low;
}

function bullish(c) {
  return c.close > c.open;
}

function bearish(c) {
  return c.close < c.open;
}

/**
 * Detect swing highs and swing lows.
 */
function detectSwings(candles, strength = 2) {
  const highs = [];
  const lows = [];

  for (
    let i = strength;
    i < candles.length - strength;
    i++
  ) {
    const c = candles[i];

    let isHigh = true;
    let isLow = true;

    for (
      let j = i - strength;
      j <= i + strength;
      j++
    ) {
      if (j === i) continue;

      if (candles[j].high >= c.high) {
        isHigh = false;
      }

      if (candles[j].low <= c.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      highs.push({
        index: i,
        price: c.high,
        time: formatTime(c),
      });
    }

    if (isLow) {
      lows.push({
        index: i,
        price: c.low,
        time: formatTime(c),
      });
    }
  }

  return { highs, lows };
}

/**
 * Determine the trend from confirmed swing structure.
 */
function getTrendFromSwings(
  swings,
  beforeIndex = Infinity
) {
  const highs = swings.highs.filter(
    s => s.index < beforeIndex
  );

  const lows = swings.lows.filter(
    s => s.index < beforeIndex
  );

  if (highs.length < 2 || lows.length < 2) {
    return 'NEUTRAL';
  }

  const h1 = highs[highs.length - 2].price;
  const h2 = highs[highs.length - 1].price;

  const l1 = lows[lows.length - 2].price;
  const l2 = lows[lows.length - 1].price;

  if (h2 > h1 && l2 > l1) {
    return 'BULLISH';
  }

  if (h2 < h1 && l2 < l1) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}

/**
 * Detect liquidity sweeps.
 *
 * Bullish sweep:
 * Price moves below a previous swing low and closes back above it.
 *
 * Bearish sweep:
 * Price moves above a previous swing high and closes back below it.
 */
function detectSweep(
  candles,
  swings,
  lookback = 35
) {
  const start = Math.max(
    0,
    candles.length - lookback
  );

  for (
    let i = candles.length - 1;
    i >= start;
    i--
  ) {
    const c = candles[i];

    const priorHighs = swings.highs.filter(
      s => s.index < i
    );

    const priorLows = swings.lows.filter(
      s => s.index < i
    );

    const lastHigh =
      priorHighs[priorHighs.length - 1];

    const lastLow =
      priorLows[priorLows.length - 1];

    // Sell-side liquidity sweep: potential bullish reversal.
    if (
      lastLow &&
      c.low < lastLow.price &&
      c.close > lastLow.price
    ) {
      return {
        detected: true,
        direction: 'BULLISH',
        sweepDirection: 'BULLISH',
        type: 'SELL-SIDE-SWEEP',

        lowSweep: true,
        highSweep: false,
        rejection: true,

        index: i,
        time: formatTime(c),

        liquidityLevel: lastLow.price,
        sweepLow: c.low,
        sweepHigh: c.high,
      };
    }

    // Buy-side liquidity sweep: potential bearish reversal.
    if (
      lastHigh &&
      c.high > lastHigh.price &&
      c.close < lastHigh.price
    ) {
      return {
        detected: true,
        direction: 'BEARISH',
        sweepDirection: 'BEARISH',
        type: 'BUY-SIDE-SWEEP',

        lowSweep: false,
        highSweep: true,
        rejection: true,

        index: i,
        time: formatTime(c),

        liquidityLevel: lastHigh.price,
        sweepLow: c.low,
        sweepHigh: c.high,
      };
    }
  }

  return {
    detected: false,
    direction: 'NONE',
    sweepDirection: 'NONE',
    type: 'NONE',

    lowSweep: false,
    highSweep: false,
    rejection: false,

    index: null,
    time: null,
    liquidityLevel: null,
    sweepLow: null,
    sweepHigh: null,
  };
}

/**
 * Detect displacement after a liquidity sweep.
 */
function detectDisplacement(
  candles,
  sweep,
  options
) {
  if (!sweep.detected) {
    return {
      detected: false,
      direction: 'NONE',
      index: null,
      time: null,
      body: null,
      averageBody: null,
      threshold: null,
      linkedToSweep: false,
    };
  }

  const end = Math.min(
    candles.length - 1,
    sweep.index + options.displacementLookback
  );

  for (
    let i = sweep.index + 1;
    i <= end;
    i++
  ) {
    const priorBodies = candles
      .slice(Math.max(0, i - 10), i)
      .map(candleBody);

    const avgBody = average(priorBodies);
    const body = candleBody(candles[i]);

    const threshold = Math.max(
      avgBody * options.displacementMultiplier,
      0
    );

    const matchesDirection =
      sweep.direction === 'BULLISH'
        ? bullish(candles[i])
        : bearish(candles[i]);

    if (
      matchesDirection &&
      body > 0 &&
      body >= threshold
    ) {
      return {
        detected: true,
        direction: sweep.direction,
        index: i,
        time: formatTime(candles[i]),
        body,
        averageBody: avgBody,
        threshold,
        linkedToSweep: true,
      };
    }
  }

  return {
    detected: false,
    direction: 'NONE',
    index: null,
    time: null,
    body: null,
    averageBody: null,
    threshold: null,
    linkedToSweep: false,
  };
}

/**
 * Detect BOS or CHoCH on the displacement candle.
 */
function detectStructureBreak(
  candles,
  swings,
  displacement
) {
  if (!displacement.detected) {
    return {
      detected: false,
      bos: false,
      choch: false,
      direction: 'NONE',
      previousTrend: 'NEUTRAL',
      index: null,
      time: null,
      brokenLevel: null,
    };
  }

  const i = displacement.index;
  const c = candles[i];

  const priorTrend = getTrendFromSwings(
    swings,
    i
  );

  const priorHighs = swings.highs.filter(
    s => s.index < i
  );

  const priorLows = swings.lows.filter(
    s => s.index < i
  );

  const high =
    priorHighs[priorHighs.length - 1];

  const low =
    priorLows[priorLows.length - 1];

  const upBreak = Boolean(
    high &&
    c.close > high.price &&
    displacement.direction === 'BULLISH'
  );

  const downBreak = Boolean(
    low &&
    c.close < low.price &&
    displacement.direction === 'BEARISH'
  );

  if (!upBreak && !downBreak) {
    return {
      detected: false,
      bos: false,
      choch: false,
      direction: 'NONE',
      previousTrend: priorTrend,
      index: null,
      time: null,
      brokenLevel: null,
    };
  }

  const direction = upBreak
    ? 'BULLISH'
    : 'BEARISH';

  const bos = priorTrend === direction;

  const choch =
    priorTrend !== 'NEUTRAL' &&
    priorTrend !== direction;

  return {
    detected: true,
    bos,
    choch,
    direction,
    previousTrend: priorTrend,
    index: i,
    time: formatTime(c),
    brokenLevel: upBreak
      ? high.price
      : low.price,
  };
}

/**
 * Detect a Fair Value Gap after the structure break.
 */
function detectFvg(
  candles,
  structureBreak,
  direction,
  lookback = 12
) {
  if (!structureBreak.detected) {
    return {
      detected: false,
      direction: 'NONE',
      high: null,
      low: null,
      index: null,
      time: null,
      invalidated: false,
    };
  }

  const start = Math.max(
    2,
    structureBreak.index + 1
  );

  const end = Math.min(
    candles.length - 1,
    structureBreak.index + lookback
  );

  for (let i = start; i <= end; i++) {
    const first = candles[i - 2];
    const third = candles[i];

    // Bullish FVG.
    if (
      direction === 'BULLISH' &&
      third.low > first.high
    ) {
      return {
        detected: true,
        direction,
        high: third.low,
        low: first.high,
        index: i,
        time: formatTime(third),
        invalidated: false,
      };
    }

    // Bearish FVG.
    if (
      direction === 'BEARISH' &&
      third.high < first.low
    ) {
      return {
        detected: true,
        direction,
        high: first.low,
        low: third.high,
        index: i,
        time: formatTime(third),
        invalidated: false,
      };
    }
  }

  return {
    detected: false,
    direction: 'NONE',
    high: null,
    low: null,
    index: null,
    time: null,
    invalidated: false,
  };
}

/**
 * Check whether price has invalidated the FVG.
 */
function checkFvgInvalidation(
  candles,
  fvg
) {
  if (!fvg.detected) return false;

  for (
    let i = fvg.index + 1;
    i < candles.length;
    i++
  ) {
    if (
      fvg.direction === 'BULLISH' &&
      candles[i].close < fvg.low
    ) {
      return true;
    }

    if (
      fvg.direction === 'BEARISH' &&
      candles[i].close > fvg.high
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validate the FVG retest.
 *
 * The latest candle must overlap the FVG, close beyond
 * the relevant edge, agree with the trade direction,
 * and remain within the candle-size filter.
 */
function analyzeRetest(
  candles,
  fvg,
  options
) {
  if (!fvg.detected || !candles.length) {
    return {
      detected: false,
      currentCandle: false,
      index: null,
      time: null,
      firstRetestIndex: null,
      latestRetestIndex: null,

      quality: {
        overlapsZone: false,
        closesBeyondZone: false,
        correctDirection: false,
        currentRange: null,
        averageBody: null,
        rangeLimit: null,
        candleSizeValid: false,
        position: 'UNKNOWN',
      },
    };
  }

  let first = null;
  let latest = null;

  for (
    let i = fvg.index + 1;
    i < candles.length;
    i++
  ) {
    const c = candles[i];

    const overlaps =
      c.low <= fvg.high &&
      c.high >= fvg.low;

    if (overlaps) {
      if (first === null) first = i;
      latest = i;
    }
  }

  const currentIndex = candles.length - 1;
  const c = candles[currentIndex];

  const overlapsZone =
    c.low <= fvg.high &&
    c.high >= fvg.low;

  const closesBeyondZone =
    fvg.direction === 'BULLISH'
      ? c.close > fvg.high
      : c.close < fvg.low;

  const correctDirection =
    fvg.direction === 'BULLISH'
      ? bullish(c)
      : bearish(c);

  const currentRange = candleRange(c);

  const averageBody = average(
    candles
      .slice(
        Math.max(0, currentIndex - 10),
        currentIndex
      )
      .map(candleBody)
  );

  const rangeLimit =
    averageBody *
    options.maximumRetestRangeMultiple;

  const candleSizeValid =
    averageBody > 0 &&
    currentRange <= rangeLimit;

  const position =
    c.close > fvg.high
      ? 'ABOVE'
      : c.close < fvg.low
        ? 'BELOW'
        : 'INSIDE';

  const currentRetest =
    overlapsZone &&
    closesBeyondZone &&
    correctDirection &&
    candleSizeValid;

  return {
    detected: first !== null,
    currentCandle: currentRetest,

    index: latest,
    time:
      latest === null
        ? null
        : formatTime(candles[latest]),

    firstRetestIndex: first,
    latestRetestIndex: latest,

    quality: {
      overlapsZone,
      closesBeyondZone,
      correctDirection,
      currentRange,
      averageBody,
      rangeLimit,
      candleSizeValid,
      position,
    },
  };
}

/**
 * Choose the stop-loss buffer.
 */
function getStopBuffer(
  price,
  configured
) {
  if (
    Number.isFinite(configured) &&
    configured >= 0
  ) {
    return configured;
  }

  return price >= 100 ? 0.1 : 0.0001;
}

/**
 * Calculate position size only when the broker-specific
 * price-unit value has been configured.
 */
function calculatePositionSize(
  riskMoney,
  riskDistance,
  options
) {
  const value = num(
    options.valuePerPriceUnitPerLot,
    null
  );

  if (!(value > 0)) {
    return {
      calculated: false,
      lots: null,
      riskMoney,
      valuePerPriceUnitPerLot: null,

      reason:
        'Broker-specific valuePerPriceUnitPerLot is required before lot size can be calculated.',
    };
  }

  if (
    !(riskDistance > 0) ||
    !(riskMoney > 0)
  ) {
    return {
      calculated: false,
      lots: null,
      riskMoney,
      valuePerPriceUnitPerLot: value,

      reason:
        'Risk distance and risk amount must be greater than zero.',
    };
  }

  const rawLots =
    riskMoney /
    (riskDistance * value);

  const step = Math.max(
    num(options.lotStep, 0.01),
    0.00000001
  );

  let lots =
    Math.floor(rawLots / step) * step;

  lots = Math.max(0, lots);

  if (Number.isFinite(options.maxLot)) {
    lots = Math.min(lots, options.maxLot);
  }

  lots = round(lots, 4);

  if (
    lots <
    num(options.minLot, 0.01)
  ) {
    return {
      calculated: false,
      lots: null,
      rawLots: round(rawLots, 6),
      riskMoney,
      valuePerPriceUnitPerLot: value,

      reason:
        'Calculated lot size is below the broker minimum lot.',
    };
  }

  return {
    calculated: true,
    lots,
    rawLots: round(rawLots, 6),
    riskMoney,
    valuePerPriceUnitPerLot: value,
    reason: null,
  };
}

/**
 * Default response schema.
 */
function baseResult(
  symbol,
  interval,
  candleCount,
  status = 'WAIT'
) {
  return {
    status,
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,

    symbol: symbol || 'UNKNOWN',
    interval: interval || 'unknown',
    candleCount,

    candleOrder: 'ASCENDING',

    trend: 'NEUTRAL',
    structure: 'UNDEFINED',

    bos: false,
    bosDirection: 'NONE',

    choch: false,
    chochDirection: 'NONE',

    currentPrice: null,

    swingHigh: null,
    swingLow: null,

    previousSwingHigh: null,
    previousSwingLow: null,

    lowerHigh: false,
    lowerLow: false,
    higherHigh: false,
    higherLow: false,

    lastSwingHighTime: null,
    lastSwingLowTime: null,

    liquidity: {
      status: 'NO SWEEP',
      detected: false,
      sweepDirection: 'NONE',
      rejection: false,
      lowSweep: false,
      highSweep: false,
      liquidityLevel: null,
      sweepLow: null,
      sweepHigh: null,
      time: null,
    },

    displacement: {
      detected: false,
      direction: 'NONE',
      index: null,
      time: null,
      body: null,
      averageBody: null,
      threshold: null,
      linkedToSweep: false,
    },

    fvg: {
      detected: false,
      direction: 'NONE',
      high: null,
      low: null,
      index: null,
      time: null,
      invalidated: false,
      retest: false,
      firstRetestIndex: null,
      latestRetestIndex: null,
      currentRetest: false,
      quality: null,
    },

    setup: {
      status: 'WAITING',
      sweepConfirmed: false,
      displacementConfirmed: false,
      structureBreakConfirmed: false,
      fvgConfirmed: false,
      fvgRetest: false,
      fvgInvalidated: false,
    },

    entry: {
      status: 'WAIT',
      confirmed: false,
      direction: 'NONE',
      price: null,
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null,
      riskDistance: null,
      riskReward: null,
      positionSize: null,
    },

    riskFilter: {
      accountBalance: null,
      riskPercent: null,
      maxRiskDistance: null,
      maximumRetestRangeMultiple: null,
      riskDistance: null,
      accepted: false,
      reason: 'Waiting for a complete setup.',
    },

    confirmationScore: {
      score: 0,
      maximum: 8,
      percentage: 0,
      validThreshold: false,
    },

    sequence: {
      sweep: { detected: false },
      displacement: { detected: false },
      structureBreak: { detected: false },
      fvg: { detected: false },
      retest: {
        detected: false,
        currentCandle: false,
      },
      validOrder: false,
      invalidReason:
        'Insufficient data or incomplete setup.',
      complete: false,
    },

    candleMetrics: null,
  };
}

/**
 * Main TRUSTFX analysis function.
 */
export function analyzeMarketStructure(
  inputCandles,
  config = {}
) {
  const options = {
    ...DEFAULTS,
    ...config,
  };

  const symbol =
    config.symbol ||
    config.symbolName ||
    'UNKNOWN';

  const interval =
    config.interval ||
    config.timeframe ||
    'unknown';

  const candles = normalizeCandles(inputCandles);

  const result = baseResult(
    symbol,
    interval,
    candles.length
  );

  if (candles.length < 12) {
    result.status = 'WAIT';

    result.sequence.invalidReason =
      'At least 12 valid candles are required.';

    return result;
  }

  const last = candles[candles.length - 1];

  const swings = detectSwings(
    candles,
    Math.max(
      1,
      Math.floor(options.swingStrength)
    )
  );

  const highs = swings.highs;
  const lows = swings.lows;

  const trend = getTrendFromSwings(swings);

  const lastHigh =
    highs[highs.length - 1] || null;

  const prevHigh =
    highs[highs.length - 2] || null;

  const lastLow =
    lows[lows.length - 1] || null;

  const prevLow =
    lows[lows.length - 2] || null;

  const higherHigh = Boolean(
    lastHigh &&
    prevHigh &&
    lastHigh.price > prevHigh.price
  );

  const lowerHigh = Boolean(
    lastHigh &&
    prevHigh &&
    lastHigh.price < prevHigh.price
  );

  const higherLow = Boolean(
    lastLow &&
    prevLow &&
    lastLow.price > prevLow.price
  );

  const lowerLow = Boolean(
    lastLow &&
    prevLow &&
    lastLow.price < prevLow.price
  );

  const structure =
    higherHigh && higherLow
      ? 'HH + HL'
      : lowerHigh && lowerLow
        ? 'LH + LL'
        : 'MIXED';

  // Analyze the complete trading sequence.
  const sweep = detectSweep(
    candles,
    swings,
    options.sweepLookback
  );

  const displacement = detectDisplacement(
    candles,
    sweep,
    options
  );

  const structureBreak = detectStructureBreak(
    candles,
    swings,
    displacement
  );

  const fvg = detectFvg(
    candles,
    structureBreak,
    structureBreak.direction,
    options.fvgLookback
  );

  fvg.invalidated = checkFvgInvalidation(
    candles,
    fvg
  );

  const retest = analyzeRetest(
    candles,
    fvg,
    options
  );

  const chronological = Boolean(
    sweep.detected &&
    displacement.detected &&
    structureBreak.detected &&
    fvg.detected &&
    sweep.index < displacement.index &&
    displacement.index <= structureBreak.index &&
    structureBreak.index < fvg.index &&
    fvg.index < candles.length
  );

  const directionMatches = Boolean(
    sweep.direction === displacement.direction &&
    displacement.direction === structureBreak.direction &&
    structureBreak.direction === fvg.direction
  );

  const validOrder =
    chronological &&
    directionMatches;

  const retestValid = Boolean(
    retest.currentCandle &&
    !fvg.invalidated &&
    validOrder
  );

  const price = last.close;

  const buffer = getStopBuffer(
    price,
    options.stopBuffer
  );

  let stopLoss = null;
  let riskDistance = null;

  let tp1 = null;
  let tp2 = null;
  let tp3 = null;

  let riskReward = null;
  let positionSize = null;

  let entryConfirmed = false;
  let entryDirection = 'NONE';
  let entryStatus = 'WAIT';

  let riskReason =
    'Waiting for a quality FVG retest.';

  if (retestValid) {
    entryDirection = fvg.direction;

    stopLoss =
      entryDirection === 'BULLISH'
        ? sweep.sweepLow - buffer
        : sweep.sweepHigh + buffer;

    riskDistance = Math.abs(
      price - stopLoss
    );

    const riskMoney =
      options.accountBalance *
      (options.riskPercent / 100);

    positionSize = calculatePositionSize(
      riskMoney,
      riskDistance,
      options
    );

    const riskWithinLimits =
      riskDistance >= options.minRiskDistance &&
      riskDistance <= options.maxRiskDistance;

    if (!riskWithinLimits) {
      riskReason =
        `Risk distance ${round(riskDistance, 5)} is outside configured limits.`;
    } else if (!positionSize.calculated) {
      riskReason = positionSize.reason;
    } else {
      tp1 =
        entryDirection === 'BULLISH'
          ? price + riskDistance * 1.5
          : price - riskDistance * 1.5;

      tp2 =
        entryDirection === 'BULLISH'
          ? price + riskDistance * 2
          : price - riskDistance * 2;

      tp3 =
        entryDirection === 'BULLISH'
          ? price + riskDistance * 3
          : price - riskDistance * 3;

      riskReward = 3;

      entryConfirmed = Boolean(
        positionSize?.calculated === true &&
        riskWithinLimits
      );

      entryStatus = entryConfirmed
        ? 'CONFIRMED'
        : 'WAIT';

      riskReason = entryConfirmed
        ? 'Setup confirmed and position size calculated.'
        : 'Position size has not been validated.';
    }
  }

  /*
   * CRITICAL VALIDATION:
   * An existing positionSize object is not enough.
   * Its calculated property must explicitly be true.
   */
  entryConfirmed = Boolean(
    entryConfirmed &&
    positionSize?.calculated === true
  );

  if (!entryConfirmed) {
    entryStatus = 'WAIT';
  }

  const scoreItems = [
    sweep.detected,
    displacement.detected,
    structureBreak.detected,
    fvg.detected,
    validOrder,
    !fvg.invalidated,
    retest.currentCandle,
    entryConfirmed,
  ];

  const score = scoreItems.filter(
    Boolean
  ).length;

  const percentage = Math.round(
    (score / scoreItems.length) * 100
  );

  result.status = entryConfirmed
    ? 'SIGNAL'
    : 'WAIT';

  result.symbol = symbol;
  result.interval = interval;
  result.candleCount = candles.length;

  result.trend = trend;
  result.structure = structure;

  result.bos = structureBreak.bos;

  result.bosDirection =
    structureBreak.bos
      ? structureBreak.direction
      : 'NONE';

  result.choch = structureBreak.choch;

  result.chochDirection =
    structureBreak.choch
      ? structureBreak.direction
      : 'NONE';

  result.currentPrice = round(price, 5);

  result.swingHigh = lastHigh
    ? round(lastHigh.price, 5)
    : null;

  result.swingLow = lastLow
    ? round(lastLow.price, 5)
    : null;

  result.previousSwingHigh = prevHigh
    ? round(prevHigh.price, 5)
    : null;

  result.previousSwingLow = prevLow
    ? round(prevLow.price, 5)
    : null;

  result.lowerHigh = lowerHigh;
  result.lowerLow = lowerLow;
  result.higherHigh = higherHigh;
  result.higherLow = higherLow;

  result.lastSwingHighTime =
    lastHigh?.time ?? null;

  result.lastSwingLowTime =
    lastLow?.time ?? null;

  result.liquidity = {
    status: sweep.detected
      ? `CONFIRMED ${sweep.type}`
      : 'NO SWEEP',

    detected: sweep.detected,

    sweepDirection: sweep.sweepDirection,
    rejection: sweep.rejection,

    lowSweep: sweep.lowSweep,
    highSweep: sweep.highSweep,

    liquidityLevel: round(
      sweep.liquidityLevel,
      5
    ),

    sweepLow: round(
      sweep.sweepLow,
      5
    ),

    sweepHigh: round(
      sweep.sweepHigh,
      5
    ),

    time: sweep.time,
  };

  result.displacement = {
    ...displacement,

    body: round(
      displacement.body,
      5
    ),

    averageBody: round(
      displacement.averageBody,
      5
    ),

    threshold: round(
      displacement.threshold,
      5
    ),
  };

  result.fvg = {
    detected: fvg.detected,
    direction: fvg.direction,

    high: round(fvg.high, 5),
    low: round(fvg.low, 5),

    index: fvg.index,
    time: fvg.time,

    invalidated: fvg.invalidated,

    retest: retest.detected,

    firstRetestIndex:
      retest.firstRetestIndex,

    latestRetestIndex:
      retest.latestRetestIndex,

    currentRetest:
      retest.currentCandle,

    quality: retest.quality,
  };

  result.setup = {
    status: entryConfirmed
      ? 'CONFIRMED'
      : 'WAITING',

    sweepConfirmed: sweep.detected,

    displacementConfirmed:
      displacement.detected,

    structureBreakConfirmed:
      structureBreak.detected,

    fvgConfirmed: fvg.detected,

    fvgRetest: retestValid,

    fvgInvalidated: fvg.invalidated,
  };

  result.entry = {
    status: entryStatus,
    confirmed: entryConfirmed,

    direction: entryConfirmed
      ? entryDirection
      : 'NONE',

    price: entryConfirmed
      ? round(price, 5)
      : null,

    stopLoss: entryConfirmed
      ? round(stopLoss, 5)
      : null,

    takeProfit1: entryConfirmed
      ? round(tp1, 5)
      : null,

    takeProfit2: entryConfirmed
      ? round(tp2, 5)
      : null,

    takeProfit3: entryConfirmed
      ? round(tp3, 5)
      : null,

    riskDistance: entryConfirmed
      ? round(riskDistance, 5)
      : null,

    riskReward: entryConfirmed
      ? riskReward
      : null,

    positionSize,
  };

  result.riskFilter = {
    accountBalance: options.accountBalance,

    riskPercent: options.riskPercent,

    maxRiskDistance:
      options.maxRiskDistance,

    maximumRetestRangeMultiple:
      options.maximumRetestRangeMultiple,

    riskDistance:
      riskDistance === null
        ? null
        : round(riskDistance, 5),

    accepted: entryConfirmed,

    reason: riskReason,
  };

  result.confirmationScore = {
    score,
    maximum: scoreItems.length,
    percentage,

    validThreshold:
      entryConfirmed &&
      score === scoreItems.length,
  };

  result.sequence = {
    sweep: {
      detected: sweep.detected,
      index: sweep.index,
      time: sweep.time,
      direction: sweep.direction,

      liquidityLevel: round(
        sweep.liquidityLevel,
        5
      ),

      sweepLow: round(
        sweep.sweepLow,
        5
      ),

      sweepHigh: round(
        sweep.sweepHigh,
        5
      ),
    },

    displacement: {
      detected: displacement.detected,
      index: displacement.index,
      time: displacement.time,
      direction: displacement.direction,
    },

    structureBreak: {
      detected: structureBreak.detected,
      bos: structureBreak.bos,
      choch: structureBreak.choch,
      direction: structureBreak.direction,

      previousTrend:
        structureBreak.previousTrend,

      index: structureBreak.index,
      time: structureBreak.time,

      brokenLevel: round(
        structureBreak.brokenLevel,
        5
      ),
    },

    fvg: {
      detected: fvg.detected,
      index: fvg.index,
      time: fvg.time,
      direction: fvg.direction,

      high: round(fvg.high, 5),
      low: round(fvg.low, 5),

      invalidated: fvg.invalidated,
    },

    retest: {
      detected: retest.detected,

      currentCandle: retestValid,

      index: retest.index,
      time: retest.time,
    },

    validOrder,

    invalidReason: entryConfirmed
      ? null
      : riskReason,

    complete: entryConfirmed,
  };

  const upperWick =
    last.high -
    Math.max(last.open, last.close);

  const lowerWick =
    Math.min(last.open, last.close) -
    last.low;

  result.candleMetrics = {
    upperWick: round(upperWick, 5),
    lowerWick: round(lowerWick, 5),

    range: round(
      candleRange(last),
      5
    ),

    body: round(
      candleBody(last),
      5
    ),
  };

  return result;
}

export default analyzeMarketStructure;
