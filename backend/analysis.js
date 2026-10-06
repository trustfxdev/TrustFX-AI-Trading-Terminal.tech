// =====================================================
// TRUSTFX INTELLIGENCE ENGINE
// Stage 3
//
// Detects:
// - Swing Highs / Lows
// - HH / HL / LH / LL
// - Trend
// - BOS
// - CHoCH
// - Liquidity
// - Sweep + Rejection
// - Displacement
// - Fair Value Gap (FVG)
// - Entry Confirmation
// =====================================================

export function analyzeMarketStructure(candles) {

  if (
    !Array.isArray(candles) ||
    candles.length < 30
  ) {
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
      entry: {
        status: "WAITING",
        direction: "NONE"
      },
      message: "Not enough candle data."
    };
  }

  // =====================================================
  // PREPARE DATA
  // =====================================================

  const data =
    [...candles]
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

    for (
      let j = 1;
      j <= left;
      j++
    ) {

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


  const highs =
    swings
      .filter(
        swing =>
          swing.type === "HIGH"
      )
      .slice(-5);


  const lows =
    swings
      .filter(
        swing =>
          swing.type === "LOW"
      )
      .slice(-5);


  if (
    highs.length < 2 ||
    lows.length < 2
  ) {

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

      entry: {
        status: "WAITING",
        direction: "NONE"
      },

      message:
        "Waiting for confirmed structure."
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

  if (
    higherHigh &&
    higherLow
  ) {
    trend = "BULLISH";
  }

  if (
    lowerHigh &&
    lowerLow
  ) {
    trend = "BEARISH";
  }


  let structure = "MIXED";

  if (
    higherHigh &&
    higherLow
  ) {
    structure = "HH + HL";
  }

  if (
    lowerHigh &&
    lowerLow
  ) {
    structure = "LH + LL";
  }


  // =====================================================
  // CURRENT CANDLE
  // =====================================================

  const current =
    data[data.length - 1];


  // =====================================================
  // BOS
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


  // =====================================================
  // CHoCH
  // =====================================================

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
  // LIQUIDITY
  // =====================================================

  const buySideLiquidity =
    latestHigh.price;

  const sellSideLiquidity =
    latestLow.price;


  const previousBuySideLiquidity =
    previousHigh.price;

  const previousSellSideLiquidity =
    previousLow.price;


  const candleRange =
    Math.max(
      current.high -
      current.low,
      0.00001
    );


  const candleBody =
    Math.abs(
      current.close -
      current.open
    );


  const upperWick =
    current.high -
    Math.max(
      current.open,
      current.close
    );


  const lowerWick =
    Math.min(
      current.open,
      current.close
    ) -
    current.low;


  // =====================================================
  // SWEEP
  // =====================================================

  const highSweep =
    current.high >
      buySideLiquidity &&
    current.close <
      buySideLiquidity;


  const lowSweep =
    current.low <
      sellSideLiquidity &&
    current.close >
      sellSideLiquidity;


  const bearishRejection =
    highSweep &&
    upperWick >=
      candleRange * 0.35;


  const bullishRejection =
    lowSweep &&
    lowerWick >=
      candleRange * 0.35;


  let sweep = false;
  let sweepDirection = "NONE";

  let rejection = false;
  let rejectionDirection = "NONE";


  if (highSweep) {

    sweep = true;
    sweepDirection = "BUY-SIDE";

  }


  if (lowSweep) {

    sweep = true;
    sweepDirection = "SELL-SIDE";

  }


  if (bearishRejection) {

    rejection = true;
    rejectionDirection = "BEARISH";

  }


  if (bullishRejection) {

    rejection = true;
    rejectionDirection = "BULLISH";

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
  // STAGE 3
  // DISPLACEMENT
  // =====================================================

  const lookback = 10;

  const recentCandles =
    data.slice(
      Math.max(
        0,
        data.length - lookback - 1
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
      : candleBody;


  const displacementMultiplier = 1.5;


  const strongBody =
    candleBody >=
    averageBody *
      displacementMultiplier;


  const bullishDisplacement =
    strongBody &&
    current.close >
      current.open;


  const bearishDisplacement =
    strongBody &&
    current.close <
      current.open;


  let displacement =
    false;

  let displacementDirection =
    "NONE";


  if (bullishDisplacement) {

    displacement = true;
    displacementDirection =
      "BULLISH";

  }


  if (bearishDisplacement) {

    displacement = true;
    displacementDirection =
      "BEARISH";

  }


  let displacementStatus =
    "NO DISPLACEMENT";


  if (displacement) {

    displacementStatus =
      "CONFIRMED";

  }


  // =====================================================
  // FAIR VALUE GAP
  //
  // Bullish FVG:
  // candle 3 low > candle 1 high
  //
  // Bearish FVG:
  // candle 3 high < candle 1 low
  // =====================================================

  let bullishFVG = false;
  let bearishFVG = false;

  let fvgHigh = null;
  let fvgLow = null;

  let fvgDirection = "NONE";


  if (data.length >= 3) {

    const candle1 =
      data[data.length - 3];

    const candle2 =
      data[data.length - 2];

    const candle3 =
      data[data.length - 1];


    // -----------------------------------------------
    // BULLISH FVG
    // -----------------------------------------------

    if (
      candle3.low >
      candle1.high
    ) {

      bullishFVG = true;

      fvgDirection =
        "BULLISH";

      fvgLow =
        candle1.high;

      fvgHigh =
        candle3.low;

    }


    // -----------------------------------------------
    // BEARISH FVG
    // -----------------------------------------------

    if (
      candle3.high <
      candle1.low
    ) {

      bearishFVG = true;

      fvgDirection =
        "BEARISH";

      fvgLow =
        candle3.high;

      fvgHigh =
        candle1.low;

    }

  }


  let fvgStatus =
    "NO FVG";


  if (
    bullishFVG ||
    bearishFVG
  ) {

    fvgStatus =
      "FVG DETECTED";

  }


  // =====================================================
  // ENTRY CONFIRMATION
  // =====================================================

  let entryStatus =
    "WAITING";

  let entryDirection =
    "NONE";


  /*
    BUY requirements:

    1. Bullish liquidity rejection
    2. Bullish displacement OR bullish BOS/CHoCH
    3. Bullish FVG
  */


  const bullishConfirmation =
    bullishRejection &&
    (
      bullishDisplacement ||
      (
        bos &&
        bosDirection ===
          "BULLISH"
      ) ||
      (
        choch &&
        chochDirection ===
          "BULLISH"
      )
    ) &&
    bullishFVG;


  /*
    SELL requirements:

    1. Bearish liquidity rejection
    2. Bearish displacement OR bearish BOS/CHoCH
    3. Bearish FVG
  */


  const bearishConfirmation =
    bearishRejection &&
    (
      bearishDisplacement ||
      (
        bos &&
        bosDirection ===
          "BEARISH"
      ) ||
      (
        choch &&
        chochDirection ===
          "BEARISH"
      )
    ) &&
    bearishFVG;


  if (bullishConfirmation) {

    entryStatus =
      "BUY CONFIRMED";

    entryDirection =
      "BUY";

  }


  if (bearishConfirmation) {

    entryStatus =
      "SELL CONFIRMED";

    entryDirection =
      "SELL";

  }


  // =====================================================
  // FINAL ANALYSIS
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

      upperWick,

      lowerWick,

      candleRange,

      candleBody

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

      candleBody,

      averageBody,

      multiplier:
        displacementMultiplier,

      bullish:
        bullishDisplacement,

      bearish:
        bearishDisplacement

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
        fvgLow

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
        entryDirection !==
        "NONE"

    }

  };

}
