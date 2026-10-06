// TRUSTFX MARKET STRUCTURE ENGINE
// Stage 1 - Swing High/Low, Trend, BOS, CHoCH

export function analyzeMarketStructure(candles) {
  if (!Array.isArray(candles) || candles.length < 20) {
    return {
      status: "waiting",
      trend: "NEUTRAL",
      structure: "WAITING",
      bos: false,
      choch: false,
      message: "Not enough candle data"
    };
  }

  // Twelve Data returns newest first.
  // We need oldest -> newest.
  const data = [...candles].reverse().map(c => ({
    time: c.datetime,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close)
  }));

  const swings = [];

  // Swing sensitivity
  const left = 2;
  const right = 2;

  for (let i = left; i < data.length - right; i++) {
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
      choch: false,
      message: "Waiting for confirmed swing structure"
    };
  }

  const previousHigh = highs[highs.length - 2];
  const latestHigh = highs[highs.length - 1];

  const previousLow = lows[lows.length - 2];
  const latestLow = lows[lows.length - 1];

  const higherHigh =
    latestHigh.price > previousHigh.price;

  const higherLow =
    latestLow.price > previousLow.price;

  const lowerHigh =
    latestHigh.price < previousHigh.price;

  const lowerLow =
    latestLow.price < previousLow.price;

  let trend = "NEUTRAL";

  if (higherHigh && higherLow) {
    trend = "BULLISH";
  } else if (lowerHigh && lowerLow) {
    trend = "BEARISH";
  }

  const current = data[data.length - 1];

  // Break of structure
  const bullishBreak =
    current.close > latestHigh.price;

  const bearishBreak =
    current.close < latestLow.price;

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

  // CHoCH:
  // A break against the current structural direction.
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

  return {
    status: "active",

    trend,

    structure:
      trend === "BULLISH"
        ? "HH + HL"
        : trend === "BEARISH"
        ? "LH + LL"
        : "MIXED",

    bos,

    bosDirection,

    choch,

    chochDirection,

    currentPrice: current.close,

    swingHigh: latestHigh.price,

    swingLow: latestLow.price,

    previousSwingHigh: previousHigh.price,

    previousSwingLow: previousLow.price,

    higherHigh,

    higherLow,

    lowerHigh,

    lowerLow,

    lastSwingHighTime: latestHigh.time,

    lastSwingLowTime: latestLow.time
  };
}
