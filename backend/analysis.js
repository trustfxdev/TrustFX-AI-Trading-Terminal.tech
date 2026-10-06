// =====================================================
// TRUSTFX INTELLIGENCE ENGINE
// Stage 3.2
//
// Detects:
// - Market Structure
// - BOS / CHoCH
// - Liquidity Sweep
// - Rejection
// - Displacement
// - Relevant FVG
// - Active FVG
// - FVG Retest
// - Entry Trigger
// =====================================================

export function analyzeMarketStructure(candles) {

  if (!Array.isArray(candles) || candles.length < 30) {
    return {
      status: "waiting",
      trend: "NEUTRAL",
      structure: "WAITING",
      entry: {
        status: "WAITING",
        direction: "NONE",
        confirmed: false
      },
      message: "Not enough candle data."
    };
  }

  // =====================================================
  // PREPARE DATA
  // =====================================================

  const data = [...candles]
    .reverse()
    .map(candle => ({
      time: candle.datetime,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close)
    }));


  // =====================================================
  // SWING DETECTION
  // =====================================================

  const swings = [];

  const left = 2;
  const right = 2;

  for (
    let i = left;
    i < data.length - right;
    i++
  ) {

    const candle = data[i];

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= left; j++) {

      if (
        candle.high <= data[i - j].high ||
        candle.high <= data[i + j].high
      ) {
        isSwingHigh = false;
      }

      if (
        candle.low >= data[i - j].low ||
        candle.low >= data[i + j].low
      ) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swings.push({
        type: "HIGH",
        price: candle.high,
        time: candle.time,
        index: i
      });
    }

    if (isSwingLow) {
      swings.push({
        type: "LOW",
        price: candle.low,
        time: candle.time,
        index: i
      });
    }
  }


  const highs = swings
    .filter(s => s.type === "HIGH")
    .slice(-5);

  const lows = swings
    .filter(s => s.type === "LOW")
    .slice(-5);


  if (highs.length < 2 || lows.length < 2) {

    return {
      status: "waiting",
      trend: "NEUTRAL",
      structure: "WAITING",

      bos: false,
      bosDirection: "NONE",

      choch: false,
      chochDirection: "NONE",

      liquidity: {
        status: "WAITING"
      },

      displacement: {
        status: "WAITING"
      },

      fvg: {
        status: "WAITING"
      },

      setup: {
        status: "WAITING",
        direction: "NONE"
      },

      entry: {
        status: "WAITING",
        direction: "NONE",
        confirmed: false
      },

      message: "Waiting for confirmed structure."
    };
  }


  // =====================================================
  // STRUCTURE
  // =====================================================

  const previousHigh =
    highs[highs.length - 2];

  const latestHigh =
    highs[highs.length - 1];

  const previousLow =
    lows[lows.length - 2];

  const latestLow =
    lows[lows.length - 1];


  const higherHigh =
    latestHigh.price >
    previousHigh.price;

  const higherLow =
    latestLow.price >
    previousLow.price;

  const lowerHigh =
    latestHigh.price <
    previousHigh.price;

  const lowerLow =
    latestLow.price <
    previousLow.price;


  let trend = "NEUTRAL";
  let structure = "MIXED";


  if (higherHigh && higherLow) {
    trend = "BULLISH";
    structure = "HH + HL";
  }


  if (lowerHigh && lowerLow) {
    trend = "BEARISH";
    structure = "LH + LL";
  }


  const current =
    data[data.length - 1];


  // =====================================================
  // BOS / CHoCH
  // =====================================================

  const bullishBreak =
    current.close >
    latestHigh.price;

  const bearishBreak =
    current.close <
    latestLow.price;


  let bos = false;
  let bosDirection = "NONE";


  if (bullishBreak) {
    bos = true;
    bosDirection = "BULLISH";
  }


  if (bearishBreak) {
    bos = true;
    bosDirection = "BEARISH";
  }


  let choch = false;
  let chochDirection = "NONE";


  if (
    trend === "BEARISH" &&
    bullishBreak
  ) {

    choch = true;
    chochDirection = "BULLISH";
  }


  if (
    trend === "BULLISH" &&
    bearishBreak
  ) {

    choch = true;
    chochDirection = "BEARISH";
  }


  // =====================================================
  // LIQUIDITY LEVELS
  // =====================================================

  const buySideLiquidity =
    latestHigh.price;

  const sellSideLiquidity =
    latestLow.price;

  const previousBuySideLiquidity =
    previousHigh.price;

  const previousSellSideLiquidity =
    previousLow.price;


  // =====================================================
  // RECENT SWEEP + REJECTION
  // =====================================================

  let recentSweep = null;

  const sweepStart =
    Math.max(
      0,
      data.length - 7
    );


  for (
    let i = sweepStart;
    i < data.length;
    i++
  ) {

    const candle =
      data[i];

    const range =
      Math.max(
        candle.high -
        candle.low,
        0.00001
      );


    const body =
      Math.abs(
        candle.close -
        candle.open
      );


    const upper =
      candle.high -
      Math.max(
        candle.open,
        candle.close
      );


    const lower =
      Math.min(
        candle.open,
        candle.close
      ) -
      candle.low;


    const highSweep =
      candle.high >
        buySideLiquidity &&
      candle.close <
        buySideLiquidity;


    const lowSweep =
      candle.low <
        sellSideLiquidity &&
      candle.close >
        sellSideLiquidity;


    const bearishRejection =
      highSweep &&
      upper >=
        range * 0.30;


    const bullishRejection =
      lowSweep &&
      lower >=
        range * 0.30;


    if (
      bearishRejection ||
      bullishRejection
    ) {

      recentSweep = {

        index: i,

        time:
          candle.time,

        direction:
          bearishRejection
            ? "BEARISH"
            : "BULLISH",

        sweepDirection:
          bearishRejection
            ? "BUY-SIDE"
            : "SELL-SIDE",

        price:
          bearishRejection
            ? candle.high
            : candle.low,

        candleBody:
          body,

        candleRange:
          range,

        upperWick:
          upper,

        lowerWick:
          lower

      };
    }
  }


  let sweep = false;
  let sweepDirection = "NONE";

  let rejection = false;
  let rejectionDirection = "NONE";

  let highSweep = false;
  let lowSweep = false;

  let bearishRejection = false;
  let bullishRejection = false;


  if (recentSweep) {

    sweep = true;
    rejection = true;

    sweepDirection =
      recentSweep.sweepDirection;

    rejectionDirection =
      recentSweep.direction;

    highSweep =
      recentSweep.sweepDirection ===
      "BUY-SIDE";

    lowSweep =
      recentSweep.sweepDirection ===
      "SELL-SIDE";

    bearishRejection =
      recentSweep.direction ===
      "BEARISH";

    bullishRejection =
      recentSweep.direction ===
      "BULLISH";
  }


  let liquidityStatus =
    "NO SWEEP";


  if (
    sweep &&
    rejection
  ) {

    liquidityStatus =
      "CONFIRMED SWEEP";

  } else if (sweep) {

    liquidityStatus =
      "SWEEP";
  }


  // =====================================================
  // DISPLACEMENT
  // =====================================================

  const lookback = 10;

  const recentCandles =
    data.slice(
      Math.max(
        0,
        data.length -
          lookback -
          1
      ),
      data.length - 1
    );


  const averageBody =
    recentCandles.length > 0
      ? recentCandles.reduce(
          (sum, candle) =>
            sum +
            Math.abs(
              candle.close -
              candle.open
            ),
          0
        ) /
        recentCandles.length
      : 0;


  const displacementMultiplier =
    1.20;


  let displacement = false;

  let displacementDirection =
    "NONE";

  let displacementIndex =
    null;

  let displacementTime =
    null;


  const displacementStart =
    recentSweep
      ? recentSweep.index + 1
      : Math.max(
          0,
          data.length - 5
        );


  for (
    let i = displacementStart;
    i < data.length;
    i++
  ) {

    const candle =
      data[i];


    const body =
      Math.abs(
        candle.close -
        candle.open
      );


    const strongBody =
      averageBody > 0 &&
      body >=
        averageBody *
        displacementMultiplier;


    if (!strongBody) {
      continue;
    }


    if (
      recentSweep &&
      recentSweep.direction ===
        "BEARISH" &&
      candle.close <
        candle.open
    ) {

      displacement = true;

      displacementDirection =
        "BEARISH";

      displacementIndex =
        i;

      displacementTime =
        candle.time;

      break;
    }


    if (
      recentSweep &&
      recentSweep.direction ===
        "BULLISH" &&
      candle.close >
        candle.open
    ) {

      displacement = true;

      displacementDirection =
        "BULLISH";

      displacementIndex =
        i;

      displacementTime =
        candle.time;

      break;
    }
  }


  let displacementStatus =
    "NO DISPLACEMENT";


  if (displacement) {
    displacementStatus =
      "CONFIRMED";
  }


  // =====================================================
  // ACTIVE FVG DETECTION
  // =====================================================

  let bullishFVG = false;
  let bearishFVG = false;

  let fvgHigh = null;
  let fvgLow = null;

  let fvgDirection =
    "NONE";

  let fvgIndex = null;

  let fvgCreatedTime =
    null;


  /*
    We search recent candles for the latest FVG
    that agrees with the displacement direction.
  */


  const searchStart =
    displacementIndex !== null
      ? Math.max(
          2,
          displacementIndex - 2
        )
      : Math.max(
          2,
          data.length - 8
        );


  for (
    let i = searchStart;
    i < data.length;
    i++
  ) {

    const candle1 =
      data[i - 2];

    const candle3 =
      data[i];


    // -----------------------------------------------
    // BULLISH FVG
    // -----------------------------------------------

    if (
      candle3.low >
      candle1.high
    ) {

      if (
        displacementDirection ===
          "BULLISH" ||
        displacementDirection ===
          "NONE"
      ) {

        bullishFVG = true;
        bearishFVG = false;

        fvgDirection =
          "BULLISH";

        fvgLow =
          candle1.high;

        fvgHigh =
          candle3.low;

        fvgIndex =
          i;

        fvgCreatedTime =
          candle3.time;
      }
    }


    // -----------------------------------------------
    // BEARISH FVG
    // -----------------------------------------------

    if (
      candle3.high <
      candle1.low
    ) {

      if (
        displacementDirection ===
          "BEARISH" ||
        displacementDirection ===
          "NONE"
      ) {

        bearishFVG = true;
        bullishFVG = false;

        fvgDirection =
          "BEARISH";

        fvgLow =
          candle3.high;

        fvgHigh =
          candle1.low;

        fvgIndex =
          i;

        fvgCreatedTime =
          candle3.time;
      }
    }
  }


  let fvgStatus =
    "NO ACTIVE FVG";


  if (
    bullishFVG ||
    bearishFVG
  ) {

    fvgStatus =
      "ACTIVE FVG";
  }


  // =====================================================
  // INVALIDATE FVG IF PRICE COMPLETELY BREAKS THROUGH
  // =====================================================

  let fvgInvalidated =
    false;


  if (
    bullishFVG &&
    current.close <
      fvgLow
  ) {

    fvgInvalidated =
      true;
  }


  if (
    bearishFVG &&
    current.close >
      fvgHigh
  ) {

    fvgInvalidated =
      true;
  }


  if (fvgInvalidated) {

    fvgStatus =
      "FVG INVALIDATED";

    bullishFVG = false;
    bearishFVG = false;

    fvgDirection =
      "NONE";
  }


  // =====================================================
  // FVG RETEST
  // =====================================================

  let fvgRetest =
    false;


  let fvgPosition =
    "AWAY";


  if (
    fvgDirection !==
      "NONE" &&
    fvgLow !== null &&
    fvgHigh !== null
  ) {

    const touchesZone =
      current.low <=
        fvgHigh &&
      current.high >=
        fvgLow;


    if (touchesZone) {

      fvgRetest =
        true;

      fvgPosition =
        "INSIDE FVG";
    }


    if (
      current.close >
      fvgHigh
    ) {

      fvgPosition =
        "ABOVE FVG";
    }


    if (
      current.close <
      fvgLow
    ) {

      fvgPosition =
        "BELOW FVG";
    }
  }


  // =====================================================
  // ENTRY TRIGGER
  // =====================================================

  let setupStatus =
    "WAITING";

  let setupDirection =
    "NONE";


  /*
    SELL setup

    BUY-SIDE SWEEP
          +
    BEARISH REJECTION
          +
    BEARISH DISPLACEMENT
          +
    BEARISH BOS / CHoCH
          +
    BEARISH FVG
  */


  const bearishStructureConfirm =
    bearishBreak ||
    (
      choch &&
      chochDirection ===
        "BEARISH"
    ) ||
    (
      bos &&
      bosDirection ===
        "BEARISH"
    );


  const bearishSetup =
    bearishRejection &&
    displacement &&
    displacementDirection ===
      "BEARISH" &&
    bearishStructureConfirm &&
    bearishFVG;


  /*
    BUY setup
  */


  const bullishStructureConfirm =
    bullishBreak ||
    (
      choch &&
      chochDirection ===
        "BULLISH"
    ) ||
    (
      bos &&
      bosDirection ===
        "BULLISH"
    );


  const bullishSetup =
    bullishRejection &&
    displacement &&
    displacementDirection ===
      "BULLISH" &&
    bullishStructureConfirm &&
    bullishFVG;


  if (bearishSetup) {

    setupStatus =
      "SELL SETUP CONFIRMED";

    setupDirection =
      "SELL";
  }


  if (bullishSetup) {

    setupStatus =
      "BUY SETUP CONFIRMED";

    setupDirection =
      "BUY";
  }


  // =====================================================
  // ENTRY
  // =====================================================

  let entryStatus =
    "WAITING";

  let entryDirection =
    "NONE";

  let entryConfirmed =
    false;


  /*
    Entry is only considered after:
      1. Setup confirmed
      2. Correct FVG retest
  */


  if (
    setupDirection ===
      "SELL"
  ) {

    entryDirection =
      "SELL";

    if (fvgRetest) {

      entryStatus =
        "SELL CONFIRMED";

      entryConfirmed =
        true;

    } else {

      entryStatus =
        "WAITING FOR FVG RETEST";
    }
  }


  if (
    setupDirection ===
      "BUY"
  ) {

    entryDirection =
      "BUY";

    if (fvgRetest) {

      entryStatus =
        "BUY CONFIRMED";

      entryConfirmed =
        true;

    } else {

      entryStatus =
        "WAITING FOR FVG RETEST";
    }
  }


  // =====================================================
  // CONFIRMATION SCORE
  // =====================================================

  let score =
    0;


  if (trend !== "NEUTRAL") {
    score += 1;
  }

  if (sweep) {
    score += 1;
  }

  if (rejection) {
    score += 1;
  }

  if (displacement) {
    score += 1;
  }

  if (bos || choch) {
    score += 1;
  }

  if (
    bullishFVG ||
    bearishFVG
  ) {
    score += 1;
  }

  if (fvgRetest) {
    score += 1;
  }


  // =====================================================
  // FINAL RESULT
  // =====================================================

  return {

    status:
      "active",

    trend,

    structure,

    bos,

    bosDirection,

    choch,

    chochDirection,


    currentPrice:
      current.close,


    swingHigh:
      latestHigh.price,

    swingLow:
      latestLow.price,


    previousSwingHigh:
      previousHigh.price,

    previousSwingLow:
      previousLow.price,


    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow,


    lastSwingHighTime:
      latestHigh.time,

    lastSwingLowTime:
      latestLow.time,


    // =================================================
    // LIQUIDITY
    // =================================================

    liquidity: {

      status:
        liquidityStatus,

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

      sweepTime:
        recentSweep
          ? recentSweep.time
          : null,

      sweepPrice:
        recentSweep
          ? recentSweep.price
          : null
    },


    // =================================================
    // DISPLACEMENT
    // =================================================

    displacement: {

      status:
        displacementStatus,

      detected:
        displacement,

      direction:
        displacementDirection,

      time:
        displacementTime,

      candleBody,

      averageBody,

      multiplier:
        displacementMultiplier
    },


    // =================================================
    // FVG
    // =================================================

    fvg: {

      status:
        fvgStatus,

      detected:
        bullishFVG ||
        bearishFVG,

      direction:
        fvgDirection,

      bullish:
        bullishFVG,

      bearish:
        bearishFVG,

      high:
        fvgHigh,

      low:
        fvgLow,

      index:
        fvgIndex,

      createdTime:
        fvgCreatedTime,

      retest:
        fvgRetest,

      position:
        fvgPosition,

      invalidated:
        fvgInvalidated
    },


    // =================================================
    // SETUP
    // =================================================

    setup: {

      status:
        setupStatus,

      direction:
        setupDirection
    },


    // =================================================
    // ENTRY
    // =================================================

    entry: {

      status:
        entryStatus,

      direction:
        entryDirection,

      confirmed:
        entryConfirmed
    },


    // =================================================
    // SCORE
    // =================================================

    confirmationScore:
      score,

    maxConfirmationScore:
      7
  };
}
