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
  return (
    candle.high -
    Math.max(candle.open, candle.close)
  );
}

function lowerWick(candle) {
  return (
    Math.min(candle.open, candle.close) -
    candle.low
  );
}

function isBullish(candle) {
  return candle.close > candle.open;
}

function isBearish(candle) {
  return candle.close < candle.open;
}

function averageBody(candles, endIndex, lookback = 20) {
  const start = Math.max(
    0,
    endIndex - lookback
  );

  const selected = candles.slice(
    start,
    endIndex
  );

  if (selected.length === 0) {
    return 0;
  }

  const total = selected.reduce(
    (sum, candle) =>
      sum + candleBody(candle),
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

    for (
      let j = 1;
      j <= strength;
      j++
    ) {
      if (
        current.high <=
          candles[i - j].high ||
        current.high <=
          candles[i + j].high
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

    for (
      let j = 1;
      j <= strength;
      j++
    ) {
      if (
        current.low >=
          candles[i - j].low ||
        current.low >=
          candles[i + j].low
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
  const candles =
    rawCandles.map(normalizeCandle);

  if (candles.length < 20) {
    return {
      status: "INSUFFICIENT DATA",
      message:
        "Not enough candles for market structure analysis."
    };
  }

  const lastIndex =
    candles.length - 1;

  const current =
    candles[lastIndex];

  const currentPrice =
    current.close;

  // --------------------------------------------------
  // STAGE 1
  // MARKET STRUCTURE
  // --------------------------------------------------

  const swingHighs =
    findSwingHighs(candles, 2);

  const swingLows =
    findSwingLows(candles, 2);

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
      lastSwingHigh.price >
        previousSwingHigh.price
    );

  const higherLow =
    !!(
      lastSwingLow &&
      previousSwingLow &&
      lastSwingLow.price >
        previousSwingLow.price
    );

  const lowerHigh =
    !!(
      lastSwingHigh &&
      previousSwingHigh &&
      lastSwingHigh.price <
        previousSwingHigh.price
    );

  const lowerLow =
    !!(
      lastSwingLow &&
      previousSwingLow &&
      lastSwingLow.price <
        previousSwingLow.price
    );

  let trend = "NEUTRAL";
  let structure = "MIXED";

  if (lowerHigh && lowerLow) {
    trend = "BEARISH";
    structure = "LH + LL";
  } else if (higherHigh && higherLow) {
    trend = "BULLISH";
    structure = "HH + HL";
  }

  // --------------------------------------------------
  // BOS / CHOCH
  // --------------------------------------------------

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

  // --------------------------------------------------
  // STAGE 2
  // LIQUIDITY
  // --------------------------------------------------

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

  // --------------------------------------------------
  // STAGE 3
  // CANDLE REJECTION
  // --------------------------------------------------

  const body =
    candleBody(current);

  const range =
    candleRange(current);

  const currentUpperWick =
    upperWick(current);

  const currentLowerWick =
    lowerWick(current);

  let highSweep = false;
  let lowSweep = false;

  if (
    buySideLiquidity !== null &&
    current.high > buySideLiquidity
  ) {
    highSweep = true;
  }

  if (
    sellSideLiquidity !== null &&
    current.low < sellSideLiquidity
  ) {
    lowSweep = true;
  }

  const bearishRejection =
    highSweep &&
    current.close <
      buySideLiquidity;

  const bullishRejection =
    lowSweep &&
    current.close >
      sellSideLiquidity;

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

  // --------------------------------------------------
  // STAGE 3.1
  // DISPLACEMENT
  // --------------------------------------------------

  const avgBody =
    averageBody(
      candles,
      lastIndex,
      20
    );

  const displacementMultiplier = 1.2;

  let displacementDetected =
    false;

  let displacementDirection =
    "NONE";

  let displacementTime =
    null;

  let displacementIndex =
    null;

  for (
    let i = Math.max(
      3,
      candles.length - 10
    );
    i < candles.length;
    i++
  ) {
    const candidate =
      candles[i];

    const candidateBody =
      candleBody(candidate);

    const candidateAverage =
      averageBody(
        candles,
        i,
        20
      );

    if (
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

      displacementIndex =
        i;
    }
  }

  // --------------------------------------------------
  // STAGE 3.2
  // FAIR VALUE GAP
  // --------------------------------------------------

  let fvg = null;

  /*
    Bullish FVG:

    Candle 1 high
          ↓
    GAP
          ↓
    Candle 3 low

    candle3.low > candle1.high
  */

  /*
    Bearish FVG:

    Candle 1 low
          ↓
    GAP
          ↓
    Candle 3 high

    candle3.high < candle1.low
  */

  for (
    let i = 2;
    i < candles.length;
    i++
  ) {
    const candle1 =
      candles[i - 2];

    const candle2 =
      candles[i - 1];

    const candle3 =
      candles[i];

    // Bullish FVG
    if (
      candle3.low >
      candle1.high
    ) {
      const gapHigh =
        candle3.low;

      const gapLow =
        candle1.high;

      fvg = {
        detected: true,
        direction: "BULLISH",
        high: gapHigh,
        low: gapLow,
        index: i,
        time: candle3.datetime
      };
    }

    // Bearish FVG
    if (
      candle3.high <
      candle1.low
    ) {
      const gapHigh =
        candle1.low;

      const gapLow =
        candle3.high;

      fvg = {
        detected: true,
        direction: "BEARISH",
        high: gapHigh,
        low: gapLow,
        index: i,
        time: candle3.datetime
      };
    }
  }

  // --------------------------------------------------
  // FIND MOST RELEVANT FVG
  // --------------------------------------------------

  let relevantFVG =
    null;

  if (fvg) {
    const fvgDirection =
      fvg.direction;

    /*
      Only accept FVG when it agrees with
      displacement direction where possible.
    */

    if (
      displacementDetected &&
      displacementDirection !==
        fvgDirection
    ) {
      relevantFVG = null;
    } else {
      relevantFVG = fvg;
    }
  }

  // --------------------------------------------------
  // FVG INVALIDATION
  // --------------------------------------------------

  let fvgInvalidated =
    false;

  if (relevantFVG) {
    if (
      relevantFVG.direction ===
      "BULLISH"
    ) {
      /*
        Bullish FVG becomes invalid if
        price closes completely below it.
      */

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
      /*
        Bearish FVG becomes invalid if
        price closes completely above it.
      */

      if (
        current.close >
        relevantFVG.high
      ) {
        fvgInvalidated = true;
      }
    }
  }

  // --------------------------------------------------
  // FVG RETEST
  // --------------------------------------------------

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

    /*
      Price overlaps the FVG.
    */

    const touchesFVG =
      current.low <= fvgHigh &&
      current.high >= fvgLow;

    if (touchesFVG) {
      fvgRetest = true;

      if (
        current.close >
        fvgHigh
      ) {
        fvgPosition =
          "ABOVE";
      } else if (
        current.close <
        fvgLow
      ) {
        fvgPosition =
          "BELOW";
      } else {
        fvgPosition =
          "INSIDE";
      }
    }
  }

  // --------------------------------------------------
  // ENTRY TRIGGER
  // --------------------------------------------------

  let entryConfirmed =
    false;

  let entryDirection =
    "NONE";

  let setupStatus =
    "WAITING";

  let entryPrice =
    null;

  let stopLoss =
    null;

  let takeProfit1 =
    null;

  let takeProfit2 =
    null;

  let takeProfit3 =
    null;

  /*
    BUY setup:

    1. Bullish liquidity sweep
    2. Bullish rejection
    3. Bullish displacement
    4. Bullish FVG
    5. FVG retest
    6. Current candle closes bullish
  */

  const bullishSetup =
    bullishRejection &&
    (
      displacementDirection ===
        "BULLISH" ||
      displacementDetected === false
    ) &&
    relevantFVG &&
    relevantFVG.direction ===
      "BULLISH" &&
    fvgRetest &&
    !fvgInvalidated;

  /*
    SELL setup:

    1. Bearish liquidity sweep
    2. Bearish rejection
    3. Bearish displacement
    4. Bearish FVG
    5. FVG retest
    6. Current candle closes bearish
  */

  const bearishSetup =
    bearishRejection &&
    (
      displacementDirection ===
        "BEARISH" ||
      displacementDetected === false
    ) &&
    relevantFVG &&
    relevantFVG.direction ===
      "BEARISH" &&
    fvgRetest &&
    !fvgInvalidated;

  if (
    bullishSetup &&
    isBullish(current)
  ) {
    entryConfirmed = true;
    entryDirection = "BUY";
    setupStatus = "CONFIRMED";

    entryPrice =
      current.close;

    /*
      SL goes below the sweep/FVG area.
    */

    const baseSL =
      Math.min(
        current.low,
        relevantFVG.low
      );

    stopLoss =
      baseSL;

    const risk =
      entryPrice -
      stopLoss;

    if (risk > 0) {
      takeProfit1 =
        entryPrice +
        risk * 1.0;

      takeProfit2 =
        entryPrice +
        risk * 2.0;

      takeProfit3 =
        entryPrice +
        risk * 3.0;
    }
  }

  if (
    bearishSetup &&
    isBearish(current)
  ) {
    entryConfirmed = true;
    entryDirection = "SELL";
    setupStatus = "CONFIRMED";

    entryPrice =
      current.close;

    /*
      SL goes above the sweep/FVG area.
    */

    const baseSL =
      Math.max(
        current.high,
        relevantFVG.high
      );

    stopLoss =
      baseSL;

    const risk =
      stopLoss -
      entryPrice;

    if (risk > 0) {
      takeProfit1 =
        entryPrice -
        risk * 1.0;

      takeProfit2 =
        entryPrice -
        risk * 2.0;

      takeProfit3 =
        entryPrice -
        risk * 3.0;
    }
  }

  // --------------------------------------------------
  // CONFIRMATION SCORE
  // --------------------------------------------------

  let confirmationScore = 0;

  const maxConfirmationScore =
    6;

  if (
    trend !== "NEUTRAL"
  ) {
    confirmationScore++;
  }

  if (sweep) {
    confirmationScore++;
  }

  if (rejection) {
    confirmationScore++;
  }

  if (
    displacementDetected
  ) {
    confirmationScore++;
  }

  if (
    relevantFVG &&
    !fvgInvalidated
  ) {
    confirmationScore++;
  }

  if (fvgRetest) {
    confirmationScore++;
  }

  // --------------------------------------------------
  // FINAL STATUS
  // --------------------------------------------------

  let finalStatus =
    "WAIT";

  if (entryConfirmed) {
    finalStatus =
      entryDirection;
  }

  // --------------------------------------------------
  // RETURN COMPLETE ANALYSIS
  // --------------------------------------------------

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

    // -----------------------------------------------
    // LIQUIDITY
    // -----------------------------------------------

    liquidity: {
      status: sweep
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
        range,

      candleBody:
        body
    },

    // -----------------------------------------------
    // DISPLACEMENT
    // -----------------------------------------------

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
        body,

      averageBody:
        avgBody,

      multiplier:
        displacementMultiplier
    },

    // -----------------------------------------------
    // FAIR VALUE GAP
    // -----------------------------------------------

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

    // -----------------------------------------------
    // SETUP
    // -----------------------------------------------

    setup: {
      status:
        setupStatus,

      direction:
        entryDirection,

      bullishSetup,

      bearishSetup,

      fvgRetest,

      fvgInvalidated
    },

    // -----------------------------------------------
    // ENTRY
    // -----------------------------------------------

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

    // -----------------------------------------------
    // CONFIRMATION SCORE
    // -----------------------------------------------

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
