// =====================================================
// TRUSTFX MARKET STRUCTURE + LIQUIDITY ENGINE
// Stage 2
//
// Detects:
// - Swing Highs
// - Swing Lows
// - HH / HL
// - LH / LL
// - Trend
// - BOS
// - CHoCH
// - Liquidity High
// - Liquidity Low
// - High Sweep
// - Low Sweep
// - Rejection
// =====================================================

export function analyzeMarketStructure(candles) {

  /*
  -------------------------------------------------------
  CHECK DATA
  -------------------------------------------------------
  */

  if (
    !Array.isArray(candles) ||
    candles.length < 20
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

      message:
        "Not enough candle data."

    };

  }


  /*
  -------------------------------------------------------
  CONVERT TWELVE DATA
  -------------------------------------------------------
  */

  const data =
    [...candles]
      .reverse()
      .map(candle => ({

        time:
          candle.datetime,

        open:
          Number(candle.open),

        high:
          Number(candle.high),

        low:
          Number(candle.low),

        close:
          Number(candle.close)

      }));


  /*
  -------------------------------------------------------
  FIND SWINGS
  -------------------------------------------------------
  */

  const swings = [];

  const left = 2;
  const right = 2;


  for (
    let i = left;
    i < data.length - right;
    i++
  ) {

    const candle =
      data[i];


    let isSwingHigh =
      true;


    let isSwingLow =
      true;


    /*
    SWING HIGH
    */

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

    }


    /*
    SWING LOW
    */

    for (
      let j = 1;
      j <= left;
      j++
    ) {

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

        price:
          candle.high,

        time:
          candle.time,

        index:
          i

      });

    }


    if (isSwingLow) {

      swings.push({

        type: "LOW",

        price:
          candle.low,

        time:
          candle.time,

        index:
          i

      });

    }

  }


  /*
  -------------------------------------------------------
  RECENT SWINGS
  -------------------------------------------------------
  */

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


  /*
  -------------------------------------------------------
  STRUCTURE CHECK
  -------------------------------------------------------
  */

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

        status:
          "WAITING"

      },

      message:
        "Waiting for confirmed structure."

    };

  }


  /*
  -------------------------------------------------------
  RECENT STRUCTURE
  -------------------------------------------------------
  */

  const previousHigh =
    highs[highs.length - 2];


  const latestHigh =
    highs[highs.length - 1];


  const previousLow =
    lows[lows.length - 2];


  const latestLow =
    lows[lows.length - 1];


  /*
  -------------------------------------------------------
  HH / HL / LH / LL
  -------------------------------------------------------
  */

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


  /*
  -------------------------------------------------------
  TREND
  -------------------------------------------------------
  */

  let trend =
    "NEUTRAL";


  if (
    higherHigh &&
    higherLow
  ) {

    trend =
      "BULLISH";

  }


  if (
    lowerHigh &&
    lowerLow
  ) {

    trend =
      "BEARISH";

  }


  /*
  -------------------------------------------------------
  STRUCTURE LABEL
  -------------------------------------------------------
  */

  let structure =
    "MIXED";


  if (
    higherHigh &&
    higherLow
  ) {

    structure =
      "HH + HL";

  }


  if (
    lowerHigh &&
    lowerLow
  ) {

    structure =
      "LH + LL";

  }


  /*
  -------------------------------------------------------
  CURRENT CANDLE
  -------------------------------------------------------
  */

  const current =
    data[data.length - 1];


  /*
  -------------------------------------------------------
  BOS
  -------------------------------------------------------
  */

  const bullishBreak =
    current.close >
    latestHigh.price;


  const bearishBreak =
    current.close <
    latestLow.price;


  let bos =
    false;


  let bosDirection =
    "NONE";


  if (bullishBreak) {

    bos =
      true;

    bosDirection =
      "BULLISH";

  }


  if (bearishBreak) {

    bos =
      true;

    bosDirection =
      "BEARISH";

  }


  /*
  -------------------------------------------------------
  CHoCH
  -------------------------------------------------------
  */

  let choch =
    false;


  let chochDirection =
    "NONE";


  if (
    trend === "BEARISH" &&
    bullishBreak
  ) {

    choch =
      true;

    chochDirection =
      "BULLISH";

  }


  if (
    trend === "BULLISH" &&
    bearishBreak
  ) {

    choch =
      true;

    chochDirection =
      "BEARISH";

  }


  /*
  =======================================================
  LIQUIDITY ENGINE
  =======================================================
  */


  /*
  -------------------------------------------------------
  LIQUIDITY LEVELS
  -------------------------------------------------------
  */

  const buySideLiquidity =
    latestHigh.price;


  const sellSideLiquidity =
    latestLow.price;


  /*
  -------------------------------------------------------
  PREVIOUS LIQUIDITY LEVELS
  -------------------------------------------------------
  */

  const previousBuySideLiquidity =
    previousHigh.price;


  const previousSellSideLiquidity =
    previousLow.price;


  /*
  -------------------------------------------------------
  CURRENT CANDLE RANGE
  -------------------------------------------------------
  */

  const candleRange =
    Math.max(
      current.high - current.low,
      0.00001
    );


  /*
  -------------------------------------------------------
  CANDLE BODY
  -------------------------------------------------------
  */

  const candleBody =
    Math.abs(
      current.close -
      current.open
    );


  /*
  -------------------------------------------------------
  WICK MEASUREMENTS
  -------------------------------------------------------
  */

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


  /*
  -------------------------------------------------------
  HIGH SWEEP
  -------------------------------------------------------

  Price trades above liquidity high
  but closes back below it.
  */

  const highSweep =
    current.high >
      buySideLiquidity &&
    current.close <
      buySideLiquidity;


  /*
  -------------------------------------------------------
  LOW SWEEP
  -------------------------------------------------------

  Price trades below liquidity low
  but closes back above it.
  */

  const lowSweep =
    current.low <
      sellSideLiquidity &&
    current.close >
      sellSideLiquidity;


  /*
  -------------------------------------------------------
  REJECTION
  -------------------------------------------------------

  Require meaningful wick relative
  to candle range.
  */

  const bearishRejection =
    highSweep &&
    upperWick >=
      candleRange * 0.35;


  const bullishRejection =
    lowSweep &&
    lowerWick >=
      candleRange * 0.35;


  /*
  -------------------------------------------------------
  LIQUIDITY DIRECTION
  -------------------------------------------------------
  */

  let sweep =
    false;


  let sweepDirection =
    "NONE";


  let rejection =
    false;


  let rejectionDirection =
    "NONE";


  if (highSweep) {

    sweep =
      true;

    sweepDirection =
      "BUY-SIDE";

  }


  if (lowSweep) {

    sweep =
      true;

    sweepDirection =
      "SELL-SIDE";

  }


  if (bearishRejection) {

    rejection =
      true;

    rejectionDirection =
      "BEARISH";

  }


  if (bullishRejection) {

    rejection =
      true;

    rejectionDirection =
      "BULLISH";

  }


  /*
  -------------------------------------------------------
  LIQUIDITY STATUS
  -------------------------------------------------------
  */

  let liquidityStatus =
    "WAITING";


  if (
    sweep &&
    rejection
  ) {

    liquidityStatus =
      "CONFIRMED SWEEP";

  } else if (
    sweep
  ) {

    liquidityStatus =
      "SWEEP";

  } else {

    liquidityStatus =
      "NO SWEEP";

  }


  /*
  -------------------------------------------------------
  RETURN COMPLETE ANALYSIS
  -------------------------------------------------------
  */

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


    /*
    -------------------------------------------------------
    LIQUIDITY RESULT
    -------------------------------------------------------
    */

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

    }

  };

}
