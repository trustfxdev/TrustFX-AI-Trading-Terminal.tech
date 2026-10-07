// backend/analysis.js

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCandle(candle) {
  return {
    datetime: candle.datetime,
    open: toNumber(candle.open),
    high: toNumber(candle.high),
    low: toNumber(candle.low),
    close: toNumber(candle.close),
    volume: toNumber(candle.volume)
  };
}

function candleBody(candle) {
  return Math.abs(candle.close - candle.open);
}

function candleRange(candle) {
  return candle.high - candle.low;
}

function upperWick(candle) {
  return candle.high - Math.max(candle.open, candle.close);
}

function lowerWick(candle) {
  return Math.min(candle.open, candle.close) - candle.low;
}

function isBullish(candle) {
  return candle.close > candle.open;
}

function isBearish(candle) {
  return candle.close < candle.open;
}

function averageBody(candles, endIndex, lookback = 20) {
  const start = Math.max(0, endIndex - lookback);

  const selected = candles.slice(start, endIndex);

  if (selected.length === 0) {
    return 0;
  }

  const total = selected.reduce(
    (sum, candle) => sum + candleBody(candle),
    0
  );

  return total / selected.length;
}

function findSwingHighs(candles, strength = 2) {
  const swings = [];

  for (
    let i = strength;
    i < candles.length - strength;
    i++
  ) {
    const current = candles[i];

    let isSwing = true;

    for (let j = 1; j <= strength; j++) {
      if (
        current.high <= candles[i - j].high ||
        current.high <= candles[i + j].high
      ) {
        isSwing = false;
        break;
      }
    }

    if (isSwing) {
      swings.push({
        index: i,
        price: current.high,
        time: current.datetime
      });
    }
  }

  return swings;
}

function findSwingLows(candles, strength = 2) {
  const swings = [];

  for (
    let i = strength;
    i < candles.length - strength;
    i++
  ) {
    const current = candles[i];

    let isSwing = true;

    for (let j = 1; j <= strength; j++) {
      if (
        current.low >= candles[i - j].low ||
        current.low >= candles[i + j].low
      ) {
        isSwing = false;
        break;
      }
    }

    if (isSwing) {
      swings.push({
        index: i,
        price: current.low,
        time: current.datetime
      });
    }
  }

  return swings;
}

function analyzeMarketStructure(rawCandles) {
  const candles = rawCandles.map(normalizeCandle);

  if (candles.length < 30) {
    return {
      status: "INSUFFICIENT DATA",
      message:
        "Not enough candles for market structure analysis."
    };
  }

  const lastIndex = candles.length - 1;
  const current = candles[lastIndex];

  const currentPrice = current.close;

  // ==================================================
  // STAGE 1 — MARKET STRUCTURE
  // ==================================================

  const swingHighs = findSwingHighs(candles, 2);
  const swingLows = findSwingLows(candles, 2);

  const lastSwingHigh =
    swingHighs.length > 0
      ? swingHighs[swingHighs.length - 1]
      : null;

  const previousSwingHigh =
    swingHighs.length > 1
      ? swingHighs[swingHighs.length - 2]
      : null;

  const lastSwingLow =
    swingLows.length > 0
      ? swingLows[swingLows.length - 1]
      : null;

  const previousSwingLow =
    swingLows.length > 1
      ? swingLows[swingLows.length - 2]
      : null;

  const higherHigh =
    !!(
      lastSwingHigh &&
      previousSwingHigh &&
      lastSwingHigh.price > previousSwingHigh.price
    );

  const higherLow =
    !!(
      lastSwingLow &&
      previousSwingLow &&
      lastSwingLow.price > previousSwingLow.price
    );

  const lowerHigh =
    !!(
      lastSwingHigh &&
      previousSwingHigh &&
      lastSwingHigh.price < previousSwingHigh.price
    );

  const lowerLow =
    !!(
      lastSwingLow &&
      previousSwingLow &&
      lastSwingLow.price < previousSwingLow.price
    );

  let trend = "NEUTRAL";
  let structure = "MIXED";

  if (higherHigh && higherLow) {
    trend = "BULLISH";
    structure = "HH + HL";
  } else if (lowerHigh && lowerLow) {
    trend = "BEARISH";
    structure = "LH + LL";
  }

  // ==================================================
  // BOS / CHOCH
  // ==================================================

  let bos = false;
  let bosDirection = "NONE";

  let choch = false;
  let chochDirection = "NONE";

  if (
    lastSwingHigh &&
    currentPrice > lastSwingHigh.price
  ) {
    bos = true;
    bosDirection = "BULLISH";

    if (trend === "BEARISH") {
      choch = true;
      chochDirection = "BULLISH";
    }
  }

  if (
    lastSwingLow &&
    currentPrice < lastSwingLow.price
  ) {
    bos = true;
    bosDirection = "BEARISH";

    if (trend === "BULLISH") {
      choch = true;
      chochDirection = "BEARISH";
    }
  }

  // ==================================================
  // STAGE 2 — LIQUIDITY
  // ==================================================

  const buySideLiquidity =
    lastSwingHigh
      ? lastSwingHigh.price
      : null;

  const sellSideLiquidity =
    lastSwingLow
      ? lastSwingLow.price
      : null;

  const previousBuySideLiquidity =
    previousSwingHigh
      ? previousSwingHigh.price
      : null;

  const previousSellSideLiquidity =
    previousSwingLow
      ? previousSwingLow.price
      : null;

  const currentBody = candleBody(current);
  const currentRange = candleRange(current);

  const currentUpperWick = upperWick(current);
  const currentLowerWick = lowerWick(current);

  let highSweep = false;
  let lowSweep = false;

  if (
    buySideLiquidity !== null &&
    current.high > buySideLiquidity &&
    current.close < buySideLiquidity
  ) {
    highSweep = true;
  }

  if (
    sellSideLiquidity !== null &&
    current.low < sellSideLiquidity &&
    current.close > sellSideLiquidity
  ) {
    lowSweep = true;
  }

  const bearishRejection =
    highSweep &&
    current.close < buySideLiquidity;

  const bullishRejection =
    lowSweep &&
    current.close > sellSideLiquidity;

  let sweep = false;
  let sweepDirection = "NONE";

  let rejection = false;
  let rejectionDirection = "NONE";

  if (bearishRejection) {
    sweep = true;
    sweepDirection = "BUY-SIDE";

    rejection = true;
    rejectionDirection = "BEARISH";
  } else if (bullishRejection) {
    sweep = true;
    sweepDirection = "SELL-SIDE";

    rejection = true;
    rejectionDirection = "BULLISH";
  }

  // ==================================================
  // STAGE 3 — TRUE DISPLACEMENT
  // ==================================================

  const displacementMultiplier = 1.2;

  let displacementDetected = false;
  let displacementDirection = "NONE";
  let displacementTime = null;
  let displacementIndex = null;
  let displacementBody = 0;
  let displacementAverageBody = 0;

  /*
    Search the most recent candles for a genuine
    displacement candle.

    IMPORTANT:
    The candidate candle is compared against the
    average body of candles BEFORE that candidate.

    Example:

    candidate body >= previous average body × 1.2
  */

  const displacementStart =
    Math.max(2, candles.length - 8);

  for (
    let i = displacementStart;
    i < candles.length;
    i++
  ) {
    const candidate = candles[i];

    const candidateBody =
      candleBody(candidate);

    const candidateAverage =
      averageBody(candles, i, 20);

    if (
      candidateAverage > 0 &&
      candidateBody >=
        candidateAverage *
          displacementMultiplier
    ) {
      displacementDetected = true;

      displacementDirection =
        isBullish(candidate)
          ? "BULLISH"
          : isBearish(candidate)
          ? "BEARISH"
          : "NONE";

      displacementTime =
        candidate.datetime;

      displacementIndex = i;

      displacementBody =
        candidateBody;

      displacementAverageBody =
        candidateAverage;
    }
  }

  // ==================================================
  // STAGE 4 — FAIR VALUE GAP
  // ==================================================

  let fvg = null;

  for (let i = 2; i < candles.length; i++) {
    const candle1 = candles[i - 2];
    const candle2 = candles[i - 1];
    const candle3 = candles[i];

    /*
      BULLISH FVG

      candle 1 high
            |
            | GAP
            |
      candle 3 low
    */

    if (candle3.low > candle1.high) {
      fvg = {
        detected: true,
        direction: "BULLISH",
        high: candle3.low,
        low: candle1.high,
        index: i,
        time: candle3.datetime
      };
    }

    /*
      BEARISH FVG

      candle 1 low
            |
            | GAP
            |
      candle 3 high
    */

    if (candle3.high < candle1.low) {
      fvg = {
        detected: true,
        direction: "BEARISH",
        high: candle1.low,
        low: candle3.high,
        index: i,
        time: candle3.datetime
      };
    }
  }

  // ==================================================
  // RELEVANT FVG
  // ==================================================

  let relevantFVG = null;

  if (fvg) {
    /*
      If there is confirmed displacement,
      prefer an FVG in the same direction.
    */

    if (
      displacementDetected &&
      displacementDirection !==
        fvg.direction
    ) {
      relevantFVG = null;
    } else {
      relevantFVG = fvg;
    }
  }

  // ==================================================
  // FVG INVALIDATION
  // ==================================================

  let fvgInvalidated = false;

  if (relevantFVG) {
    if (
      relevantFVG.direction ===
      "BULLISH"
    ) {
      if (
        current.close <
        relevantFVG.low
      ) {
        fvgInvalidated = true;
      }
    }

    if (
      relevantFVG.direction ===
      "BEARISH"
    ) {
      if (
        current.close >
        relevantFVG.high
      ) {
        fvgInvalidated = true;
      }
    }
  }

  // ==================================================
  // FVG RETEST
  // ==================================================

  let fvgRetest = false;
  let fvgPosition = "NONE";

  if (
    relevantFVG &&
    !fvgInvalidated
  ) {
    const fvgHigh =
      relevantFVG.high;

    const fvgLow =
      relevantFVG.low;

    const touchesFVG =
      current.low <= fvgHigh &&
      current.high >= fvgLow;

    if (touchesFVG) {
      fvgRetest = true;

      if (
        current.close > fvgHigh
      ) {
        fvgPosition = "ABOVE";
      } else if (
        current.close < fvgLow
      ) {
        fvgPosition = "BELOW";
      } else {
        fvgPosition = "INSIDE";
      }
    }
  }

  // ==================================================
  // STAGE 5 — ENTRY CONFIRMATION
  // ==================================================

  /*
    IMPORTANT:

    We now require market structure confirmation.

    BUY:
      bullish structure
      OR bullish BOS/CHoCH

    SELL:
      bearish structure
      OR bearish BOS/CHoCH
  */

  const bullishStructureConfirmed =
    trend === "BULLISH" ||
    bosDirection === "BULLISH" ||
    chochDirection === "BULLISH";

  const bearishStructureConfirmed =
    trend === "BEARISH" ||
    bosDirection === "BEARISH" ||
    chochDirection === "BEARISH";

  /*
    Require TRUE displacement.

    A previous bug allowed a setup to pass when
    displacementDetected was false.

    That is removed.

    We now require real displacement.
  */

  const bullishDisplacementConfirmed =
    displacementDetected &&
    displacementDirection ===
      "BULLISH";

  const bearishDisplacementConfirmed =
    displacementDetected &&
    displacementDirection ===
      "BEARISH";

  const bullishSetup =
    bullishStructureConfirmed &&
    bullishRejection &&
    bullishDisplacementConfirmed &&
    relevantFVG &&
    relevantFVG.direction ===
      "BULLISH" &&
    fvgRetest &&
    !fvgInvalidated;

  const bearishSetup =
    bearishStructureConfirmed &&
    bearishRejection &&
    bearishDisplacementConfirmed &&
    relevantFVG &&
    relevantFVG.direction ===
      "BEARISH" &&
    fvgRetest &&
    !fvgInvalidated;

  let entryConfirmed = false;
  let entryDirection = "NONE";
  let setupStatus = "WAITING";

  let entryPrice = null;
  let stopLoss = null;

  let takeProfit1 = null;
  let takeProfit2 = null;
  let takeProfit3 = null;

  // ==================================================
  // BUY
  // ==================================================

  if (
    bullishSetup &&
    isBullish(current)
  ) {
    entryConfirmed = true;
    entryDirection = "BUY";
    setupStatus = "CONFIRMED";

    entryPrice =
      current.close;

    stopLoss =
      Math.min(
        current.low,
        relevantFVG.low
      );

    const risk =
      entryPrice -
      stopLoss;

    if (risk > 0) {
      takeProfit1 =
        entryPrice +
        risk * 1;

      takeProfit2 =
        entryPrice +
        risk * 2;

      takeProfit3 =
        entryPrice +
        risk * 3;
    }
  }

  // ==================================================
  // SELL
  // ==================================================

  if (
    bearishSetup &&
    isBearish(current)
  ) {
    entryConfirmed = true;
    entryDirection = "SELL";
    setupStatus = "CONFIRMED";

    entryPrice =
      current.close;

    stopLoss =
      Math.max(
        current.high,
        relevantFVG.high
      );

    const risk =
      stopLoss -
      entryPrice;

    if (risk > 0) {
      takeProfit1 =
        entryPrice -
        risk * 1;

      takeProfit2 =
        entryPrice -
        risk * 2;

      takeProfit3 =
        entryPrice -
        risk * 3;
    }
  }

  // ==================================================
  // CONFIRMATION SCORE
  // ==================================================

  let confirmationScore = 0;

  const maxConfirmationScore = 7;

  // 1 — Structure
  if (
    trend !== "NEUTRAL"
  ) {
    confirmationScore++;
  }

  // 2 — Liquidity sweep
  if (sweep) {
    confirmationScore++;
  }

  // 3 — Rejection
  if (rejection) {
    confirmationScore++;
  }

  // 4 — True displacement
  if (
    displacementDetected
  ) {
    confirmationScore++;
  }

  // 5 — BOS / CHoCH
  if (
    bos ||
    choch
  ) {
    confirmationScore++;
  }

  // 6 — Valid FVG
  if (
    relevantFVG &&
    !fvgInvalidated
  ) {
    confirmationScore++;
  }

  // 7 — FVG retest
  if (fvgRetest) {
    confirmationScore++;
  }

  let finalStatus = "WAIT";

  if (entryConfirmed) {
    finalStatus =
      entryDirection;
  }

  // ==================================================
  // RETURN
  // ==================================================

  return {
    status: finalStatus,

    trend,

    structure,

    bos,
    bosDirection,

    choch,
    chochDirection,

    currentPrice,

    swingHigh:
      lastSwingHigh
        ? lastSwingHigh.price
        : null,

    swingLow:
      lastSwingLow
        ? lastSwingLow.price
        : null,

    previousSwingHigh:
      previousSwingHigh
        ? previousSwingHigh.price
        : null,

    previousSwingLow:
      previousSwingLow
        ? previousSwingLow.price
        : null,

    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow,

    lastSwingHighTime:
      lastSwingHigh
        ? lastSwingHigh.time
        : null,

    lastSwingLowTime:
      lastSwingLow
        ? lastSwingLow.time
        : null,

    // ==================================================
    // LIQUIDITY
    // ==================================================

    liquidity: {
      status:
        sweep
          ? "CONFIRMED SWEEP"
          : "NO SWEEP",

      buySideLiquidity,

      sellSideLiquidity,

      previousBuySideLiquidity,

      previousSellSideLiquidity,

      sweep,

      sweepDirection,

      rejection,

      rejectionDirection,

      highSweep,

      lowSweep,

      bearishRejection,

      bullishRejection,

      upperWick:
        currentUpperWick,

      lowerWick:
        currentLowerWick,

      candleRange:
        currentRange,

      candleBody:
        currentBody
    },

    // ==================================================
    // DISPLACEMENT
    // ==================================================

    displacement: {
      status:
        displacementDetected
          ? "DISPLACEMENT DETECTED"
          : "NO DISPLACEMENT",

      detected:
        displacementDetected,

      direction:
        displacementDirection,

      time:
        displacementTime,

      index:
        displacementIndex,

      candleBody:
        displacementBody,

      averageBody:
        displacementAverageBody,

      multiplier:
        displacementMultiplier,

      validThreshold:
        displacementAverageBody *
        displacementMultiplier
    },

    // ==================================================
    // FVG
    // ==================================================

    fvg: {
      status:
        relevantFVG
          ? "RELEVANT FVG DETECTED"
          : "NO RELEVANT FVG",

      detected:
        !!relevantFVG,

      direction:
        relevantFVG
          ? relevantFVG.direction
          : "NONE",

      bullish:
        !!(
          relevantFVG &&
          relevantFVG.direction ===
            "BULLISH"
        ),

      bearish:
        !!(
          relevantFVG &&
          relevantFVG.direction ===
            "BEARISH"
        ),

      high:
        relevantFVG
          ? relevantFVG.high
          : null,

      low:
        relevantFVG
          ? relevantFVG.low
          : null,

      index:
        relevantFVG
          ? relevantFVG.index
          : null,

      time:
        relevantFVG
          ? relevantFVG.time
          : null,

      invalidated:
        fvgInvalidated,

      retest:
        fvgRetest,

      position:
        fvgPosition
    },

    // ==================================================
    // SETUP
    // ==================================================

    setup: {
      status:
        setupStatus,

      direction:
        entryDirection,

      bullishSetup,

      bearishSetup,

      structureConfirmed:
        bullishStructureConfirmed ||
        bearishStructureConfirmed,

      displacementConfirmed:
        bullishDisplacementConfirmed ||
        bearishDisplacementConfirmed,

      bosConfirmed:
        bos ||
        choch,

      fvgRetest,

      fvgInvalidated
    },

    // ==================================================
    // ENTRY
    // ==================================================

    entry: {
      status:
        entryConfirmed
          ? "CONFIRMED"
          : "WAITING",

      direction:
        entryDirection,

      confirmed:
        entryConfirmed,

      price:
        entryPrice,

      stopLoss,

      takeProfit1,

      takeProfit2,

      takeProfit3
    },

    // ==================================================
    // SCORE
    // ==================================================

    confirmationScore,

    maxConfirmationScore,

    confirmationPercent:
      Math.round(
        (
          confirmationScore /
          maxConfirmationScore
        ) * 100
      )
  };
}

export {
  analyzeMarketStructure
};
