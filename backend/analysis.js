// ============================================================
// TRUSTFX MARKET STRUCTURE ENGINE
// Stage 3.4
//
// Sequence:
// Liquidity Sweep
//      ↓
// Rejection
//      ↓
// Displacement
//      ↓
// BOS / CHoCH
//      ↓
// FVG
//      ↓
// FVG Retest
//      ↓
// Entry Confirmation
//
// Important:
// Twelve Data can return candles newest-first.
// This engine normalizes candles into ASCENDING chronological
// order before performing analysis.
// ============================================================


// ============================================================
// BASIC CANDLE HELPERS
// ============================================================

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}


function candleTime(candle) {
  return String(
    candle.datetime ||
    candle.time ||
    candle.date ||
    ""
  );
}


function candleOpen(candle) {
  return num(candle.open);
}


function candleHigh(candle) {
  return num(candle.high);
}


function candleLow(candle) {
  return num(candle.low);
}


function candleClose(candle) {
  return num(candle.close);
}


function candleBody(candle) {
  return Math.abs(
    candleClose(candle) -
    candleOpen(candle)
  );
}


function upperWick(candle) {
  return (
    candleHigh(candle) -
    Math.max(
      candleOpen(candle),
      candleClose(candle)
    )
  );
}


function lowerWick(candle) {
  return (
    Math.min(
      candleOpen(candle),
      candleClose(candle)
    ) -
    candleLow(candle)
  );
}


function candleRange(candle) {
  return (
    candleHigh(candle) -
    candleLow(candle)
  );
}


function isBullishCandle(candle) {
  return candleClose(candle) >
    candleOpen(candle);
}


function isBearishCandle(candle) {
  return candleClose(candle) <
    candleOpen(candle);
}


// ============================================================
// NORMALIZE CANDLES
// ============================================================
//
// Twelve Data may return newest-first.
// We force oldest → newest.
//
// Example:
//
// OLD → ... → NEW
//
// This is critical for:
// - BOS
// - CHoCH
// - displacement
// - FVG
// - retest
// - sequence detection
// ============================================================

function normalizeCandles(rawCandles) {

  const candles = Array.isArray(rawCandles)
    ? rawCandles
        .map((candle) => ({
          ...candle,
          open: num(candle.open),
          high: num(candle.high),
          low: num(candle.low),
          close: num(candle.close)
        }))
        .filter((candle) =>
          candleTime(candle) !== "" &&
          candleHigh(candle) >= candleLow(candle)
        )
    : [];

  candles.sort(
    (a, b) =>
      new Date(candleTime(a)).getTime() -
      new Date(candleTime(b)).getTime()
  );

  return candles;
}


// ============================================================
// AVERAGE BODY
// ============================================================

function averageBody(
  candles,
  endIndex,
  lookback = 20
) {

  const start =
    Math.max(
      0,
      endIndex - lookback
    );

  const bodies = [];

  for (
    let i = start;
    i < endIndex;
    i++
  ) {
    bodies.push(
      candleBody(candles[i])
    );
  }

  if (bodies.length === 0) {
    return 0;
  }

  const total =
    bodies.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  return total / bodies.length;
}


// ============================================================
// SWING DETECTION
// ============================================================

function isSwingHigh(
  candles,
  index,
  strength = 2
) {

  if (
    index < strength ||
    index >= candles.length - strength
  ) {
    return false;
  }

  const current =
    candleHigh(candles[index]);

  for (
    let i = 1;
    i <= strength;
    i++
  ) {

    if (
      current <=
      candleHigh(candles[index - i])
    ) {
      return false;
    }

    if (
      current <=
      candleHigh(candles[index + i])
    ) {
      return false;
    }
  }

  return true;
}


function isSwingLow(
  candles,
  index,
  strength = 2
) {

  if (
    index < strength ||
    index >= candles.length - strength
  ) {
    return false;
  }

  const current =
    candleLow(candles[index]);

  for (
    let i = 1;
    i <= strength;
    i++
  ) {

    if (
      current >=
      candleLow(candles[index - i])
    ) {
      return false;
    }

    if (
      current >=
      candleLow(candles[index + i])
    ) {
      return false;
    }
  }

  return true;
}


// ============================================================
// BUILD SWING LIST
// ============================================================

function getSwings(candles) {

  const swingHighs = [];
  const swingLows = [];

  for (
    let i = 2;
    i < candles.length - 2;
    i++
  ) {

    if (
      isSwingHigh(
        candles,
        i,
        2
      )
    ) {

      swingHighs.push({
        index: i,
        price:
          candleHigh(candles[i]),
        time:
          candleTime(candles[i])
      });
    }

    if (
      isSwingLow(
        candles,
        i,
        2
      )
    ) {

      swingLows.push({
        index: i,
        price:
          candleLow(candles[i]),
        time:
          candleTime(candles[i])
      });
    }
  }

  return {
    swingHighs,
    swingLows
  };
}


// ============================================================
// MARKET TREND / STRUCTURE
// ============================================================

function detectStructure(candles) {

  const {
    swingHighs,
    swingLows
  } = getSwings(candles);

  const lastTwoHighs =
    swingHighs.slice(-2);

  const lastTwoLows =
    swingLows.slice(-2);

  let trend = "NEUTRAL";
  let structure = "UNDEFINED";

  let higherHigh = false;
  let higherLow = false;
  let lowerHigh = false;
  let lowerLow = false;

  let swingHigh = null;
  let previousSwingHigh = null;

  let swingLow = null;
  let previousSwingLow = null;

  if (lastTwoHighs.length >= 2) {

    previousSwingHigh =
      lastTwoHighs[0].price;

    swingHigh =
      lastTwoHighs[1].price;

    higherHigh =
      swingHigh >
      previousSwingHigh;

    lowerHigh =
      swingHigh <
      previousSwingHigh;
  }

  if (lastTwoLows.length >= 2) {

    previousSwingLow =
      lastTwoLows[0].price;

    swingLow =
      lastTwoLows[1].price;

    higherLow =
      swingLow >
      previousSwingLow;

    lowerLow =
      swingLow <
      previousSwingLow;
  }

  if (
    higherHigh &&
    higherLow
  ) {

    trend = "BULLISH";
    structure = "HH + HL";

  } else if (
    lowerHigh &&
    lowerLow
  ) {

    trend = "BEARISH";
    structure = "LH + LL";

  } else if (higherHigh) {

    trend = "BULLISH";
    structure = "HH";

  } else if (higherLow) {

    trend = "BULLISH";
    structure = "HL";

  } else if (lowerHigh) {

    trend = "BEARISH";
    structure = "LH";

  } else if (lowerLow) {

    trend = "BEARISH";
    structure = "LL";
  }

  return {
    trend,
    structure,

    swingHigh,
    swingLow,

    previousSwingHigh,
    previousSwingLow,

    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow,

    lastSwingHigh:
      lastTwoHighs.length
        ? lastTwoHighs[
            lastTwoHighs.length - 1
          ]
        : null,

    lastSwingLow:
      lastTwoLows.length
        ? lastTwoLows[
            lastTwoLows.length - 1
          ]
        : null,

    swingHighs,
    swingLows
  };
}


// ============================================================
// LIQUIDITY SWEEP DETECTION
// ============================================================
//
// Bullish setup:
// Price sweeps sell-side liquidity
// → trades below swing low
// → closes back above it.
//
// Bearish setup:
// Price sweeps buy-side liquidity
// → trades above swing high
// → closes back below it.
// ============================================================

function detectSweepEvents(
  candles,
  structure
) {

  const events = [];

  const {
    swingHighs,
    swingLows
  } = structure;

  const start =
    Math.max(
      0,
      candles.length - 30
    );

  for (
    let i = start;
    i < candles.length;
    i++
  ) {

    const candle =
      candles[i];

    // --------------------------------------------------------
    // SELL-SIDE SWEEP
    // --------------------------------------------------------

    for (
      let s = swingLows.length - 1;
      s >= 0;
      s--
    ) {

      const swing =
        swingLows[s];

      if (
        swing.index >= i
      ) {
        continue;
      }

      const swept =
        candleLow(candle) <
        swing.price;

      const reclaimed =
        candleClose(candle) >
        swing.price;

      if (
        swept &&
        reclaimed
      ) {

        const wick =
          lowerWick(candle);

        const body =
          candleBody(candle);

        const range =
          candleRange(candle);

        const rejection =
          wick > 0 &&
          wick >= body * 0.25 &&
          range > 0;

        events.push({
          type: "SELL-SIDE SWEEP",
          direction: "BULLISH",
          index: i,
          time:
            candleTime(candle),
          level:
            swing.price,
          wick,
          body,
          range,
          rejection
        });

        break;
      }
    }


    // --------------------------------------------------------
    // BUY-SIDE SWEEP
    // --------------------------------------------------------

    for (
      let s = swingHighs.length - 1;
      s >= 0;
      s--
    ) {

      const swing =
        swingHighs[s];

      if (
        swing.index >= i
      ) {
        continue;
      }

      const swept =
        candleHigh(candle) >
        swing.price;

      const rejected =
        candleClose(candle) <
        swing.price;

      if (
        swept &&
        rejected
      ) {

        const wick =
          upperWick(candle);

        const body =
          candleBody(candle);

        const range =
          candleRange(candle);

        const rejection =
          wick > 0 &&
          wick >= body * 0.25 &&
          range > 0;

        events.push({
          type: "BUY-SIDE SWEEP",
          direction: "BEARISH",
          index: i,
          time:
            candleTime(candle),
          level:
            swing.price,
          wick,
          body,
          range,
          rejection
        });

        break;
      }
    }
  }

  return events;
}


// ============================================================
// DISPLACEMENT DETECTION
// ============================================================
//
// A displacement candle must have:
// body >= average previous body × multiplier
//
// Stage 3.4 also links it to a recent sweep.
// ============================================================

function detectDisplacement(
  candles,
  sweepEvents
) {

  const candidates = [];

  const start =
    Math.max(
      20,
      candles.length - 15
    );

  for (
    let i = start;
    i < candles.length;
    i++
  ) {

    const candle =
      candles[i];

    const body =
      candleBody(candle);

    const avg =
      averageBody(
        candles,
        i,
        20
      );

    if (avg <= 0) {
      continue;
    }

    const threshold =
      avg * 1.2;

    if (
      body >= threshold
    ) {

      const direction =
        isBullishCandle(candle)
          ? "BULLISH"
          : isBearishCandle(candle)
            ? "BEARISH"
            : "NONE";

      if (
        direction === "NONE"
      ) {
        continue;
      }

      // Find nearest compatible sweep
      const compatibleSweeps =
        sweepEvents.filter(
          (event) =>
            event.direction ===
              direction &&
            event.index < i &&
            i - event.index <= 10
        );

      const linkedSweep =
        compatibleSweeps.length
          ? compatibleSweeps[
              compatibleSweeps.length - 1
            ]
          : null;

      candidates.push({
        index: i,
        time:
          candleTime(candle),
        direction,
        candleBody: body,
        averageBody: avg,
        threshold,
        linkedSweep
      });
    }
  }

  if (
    candidates.length === 0
  ) {

    return {
      detected: false,
      direction: "NONE",
      index: null,
      time: null,
      candleBody: 0,
      averageBody: 0,
      threshold: 0,
      linkedSweep: null
    };
  }

  // Prefer a displacement that follows a sweep.
  const linked =
    candidates.filter(
      (candidate) =>
        candidate.linkedSweep
    );

  const selected =
    linked.length
      ? linked[linked.length - 1]
      : candidates[candidates.length - 1];

  return {
    detected: true,
    direction:
      selected.direction,
    index:
      selected.index,
    time:
      selected.time,
    candleBody:
      selected.candleBody,
    averageBody:
      selected.averageBody,
    threshold:
      selected.threshold,
    linkedSweep:
      selected.linkedSweep
  };
}


// ============================================================
// BOS / CHoCH
// ============================================================
//
// Bullish:
// displacement closes above a prior swing high.
//
// Bearish:
// displacement closes below a prior swing low.
//
// CHoCH:
// break happens against the previous trend.
//
// BOS:
// break continues the existing trend.
// ============================================================

function detectStructureBreak(
  candles,
  structure,
  displacement
) {

  if (
    !displacement.detected ||
    displacement.index === null
  ) {

    return {
      bos: false,
      bosDirection: "NONE",
      choch: false,
      chochDirection: "NONE",
      brokenLevel: null,
      brokenLevelTime: null
    };
  }

  const i =
    displacement.index;

  const candle =
    candles[i];

  let brokenLevel = null;
  let brokenLevelTime = null;

  let direction =
    displacement.direction;

  if (
    direction === "BULLISH"
  ) {

    const candidates =
      structure.swingHighs.filter(
        (swing) =>
          swing.index < i
      );

    if (candidates.length) {

      const level =
        candidates[
          candidates.length - 1
        ];

      if (
        candleClose(candle) >
        level.price
      ) {

        brokenLevel =
          level.price;

        brokenLevelTime =
          level.time;
      }
    }

  } else if (
    direction === "BEARISH"
  ) {

    const candidates =
      structure.swingLows.filter(
        (swing) =>
          swing.index < i
      );

    if (candidates.length) {

      const level =
        candidates[
          candidates.length - 1
        ];

      if (
        candleClose(candle) <
        level.price
      ) {

        brokenLevel =
          level.price;

        brokenLevelTime =
          level.time;
      }
    }
  }

  if (
    brokenLevel === null
  ) {

    return {
      bos: false,
      bosDirection: "NONE",
      choch: false,
      chochDirection: "NONE",
      brokenLevel: null,
      brokenLevelTime: null
    };
  }

  const previousTrend =
    structure.trend;

  const choch =
    (
      previousTrend === "BEARISH" &&
      direction === "BULLISH"
    ) ||
    (
      previousTrend === "BULLISH" &&
      direction === "BEARISH"
    );

  return {
    bos: !choch,
    bosDirection:
      !choch
        ? direction
        : "NONE",

    choch,
    chochDirection:
      choch
        ? direction
        : "NONE",

    brokenLevel,
    brokenLevelTime
  };
}


// ============================================================
// FVG DETECTION
// ============================================================
//
// Bullish FVG:
//
// Candle 1 high < Candle 3 low
//
// Bearish FVG:
//
// Candle 1 low > Candle 3 high
//
// Stage 3.4:
// FVG must be linked to the displacement candle.
// ============================================================

function detectLinkedFVG(
  candles,
  displacement
) {

  if (
    !displacement.detected ||
    displacement.index === null
  ) {

    return {
      detected: false,
      direction: "NONE",
      bullish: false,
      bearish: false,
      high: null,
      low: null,
      index: null,
      time: null
    };
  }

  const d =
    displacement.index;

  const candidates = [];

  const start =
    Math.max(
      2,
      d - 2
    );

  const end =
    Math.min(
      candles.length - 1,
      d + 3
    );

  for (
    let i = start;
    i <= end;
    i++
  ) {

    if (
      i < 2
    ) {
      continue;
    }

    const c1 =
      candles[i - 2];

    const c2 =
      candles[i - 1];

    const c3 =
      candles[i];

    // --------------------------------------------------------
    // BULLISH FVG
    // --------------------------------------------------------

    const bullishFVG =
      candleLow(c3) >
      candleHigh(c1);

    if (
      bullishFVG
    ) {

      const linked =
        (
          i === d ||
          i - 1 === d ||
          i - 2 === d
        );

      if (
        linked &&
        displacement.direction ===
          "BULLISH"
      ) {

        candidates.push({
          detected: true,
          direction: "BULLISH",
          bullish: true,
          bearish: false,
          high:
            candleLow(c3),
          low:
            candleHigh(c1),
          index: i,
          time:
            candleTime(c3)
        });
      }
    }


    // --------------------------------------------------------
    // BEARISH FVG
    // --------------------------------------------------------

    const bearishFVG =
      candleHigh(c3) <
      candleLow(c1);

    if (
      bearishFVG
    ) {

      const linked =
        (
          i === d ||
          i - 1 === d ||
          i - 2 === d
        );

      if (
        linked &&
        displacement.direction ===
          "BEARISH"
      ) {

        candidates.push({
          detected: true,
          direction: "BEARISH",
          bullish: false,
          bearish: true,
          high:
            candleLow(c1),
          low:
            candleHigh(c3),
          index: i,
          time:
            candleTime(c3)
        });
      }
    }
  }

  if (
    candidates.length === 0
  ) {

    return {
      detected: false,
      direction: "NONE",
      bullish: false,
      bearish: false,
      high: null,
      low: null,
      index: null,
      time: null
    };
  }

  return candidates[
    candidates.length - 1
  ];
}


// ============================================================
// FVG INVALIDATION
// ============================================================

function checkFVGInvalidation(
  candles,
  fvg
) {

  if (
    !fvg.detected
  ) {
    return false;
  }

  for (
    let i = fvg.index + 1;
    i < candles.length;
    i++
  ) {

    const candle =
      candles[i];

    if (
      fvg.direction ===
      "BULLISH"
    ) {

      // Full close below FVG
      if (
        candleClose(candle) <
        fvg.low
      ) {
        return true;
      }
    }

    if (
      fvg.direction ===
      "BEARISH"
    ) {

      // Full close above FVG
      if (
        candleClose(candle) >
        fvg.high
      ) {
        return true;
      }
    }
  }

  return false;
}


// ============================================================
// FVG RETEST
// ============================================================
//
// Retest means price comes back into the active FVG.
// Current candle must interact with the zone.
//
// Bullish:
// low <= FVG high AND high >= FVG low
//
// Bearish:
// high >= FVG low AND low <= FVG high
// ============================================================

function detectFVGRetest(
  candles,
  fvg,
  invalidated
) {

  if (
    !fvg.detected ||
    invalidated
  ) {

    return {
      retest: false,
      position: "NONE",
      index: null,
      time: null
    };
  }

  const currentIndex =
    candles.length - 1;

  const current =
    candles[currentIndex];

  const zoneHigh =
    fvg.high;

  const zoneLow =
    fvg.low;

  const touched =
    candleLow(current) <= zoneHigh &&
    candleHigh(current) >= zoneLow;

  if (
    !touched
  ) {

    return {
      retest: false,
      position:
        candleClose(current) > zoneHigh
          ? "ABOVE"
          : candleClose(current) < zoneLow
            ? "BELOW"
            : "OUTSIDE",
      index: null,
      time: null
    };
  }

  let position = "INSIDE";

  if (
    candleClose(current) >
    zoneHigh
  ) {
    position = "ABOVE";
  }

  if (
    candleClose(current) <
    zoneLow
  ) {
    position = "BELOW";
  }

  return {
    retest: true,
    position,
    index: currentIndex,
    time:
      candleTime(current)
  };
}


// ============================================================
// ENTRY TRIGGER
// ============================================================
//
// Bullish:
// current candle interacts with FVG
// AND closes bullish
// AND closes above FVG low.
//
// Bearish:
// current candle interacts with FVG
// AND closes bearish
// AND closes below FVG high.
// ============================================================

function detectEntryTrigger(
  candles,
  fvg,
  fvgRetest
) {

  if (
    !fvg.detected ||
    !fvgRetest.retest
  ) {

    return {
      confirmed: false,
      direction: "NONE",
      price: null
    };
  }

  const current =
    candles[candles.length - 1];

  const close =
    candleClose(current);

  if (
    fvg.direction ===
      "BULLISH" &&
    isBullishCandle(current) &&
    close >= fvg.low
  ) {

    return {
      confirmed: true,
      direction: "BUY",
      price: close
    };
  }

  if (
    fvg.direction ===
      "BEARISH" &&
    isBearishCandle(current) &&
    close <= fvg.high
  ) {

    return {
      confirmed: true,
      direction: "SELL",
      price: close
    };
  }

  return {
    confirmed: false,
    direction: "NONE",
    price: null
  };
}


// ============================================================
// RISK LEVELS
// ============================================================

function calculateRiskLevels(
  candles,
  direction,
  entryPrice,
  sweepEvent
) {

  if (
    !entryPrice ||
    !sweepEvent
  ) {

    return {
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null
    };
  }

  let stopLoss;

  if (
    direction === "BUY"
  ) {

    stopLoss =
      sweepEvent.level;

  } else if (
    direction === "SELL"
  ) {

    stopLoss =
      sweepEvent.level;

  } else {

    return {
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null
    };
  }

  const risk =
    Math.abs(
      entryPrice -
      stopLoss
    );

  if (
    risk <= 0
  ) {

    return {
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null
    };
  }

  let tp1;
  let tp2;
  let tp3;

  if (
    direction === "BUY"
  ) {

    tp1 =
      entryPrice +
      risk * 1.5;

    tp2 =
      entryPrice +
      risk * 2.0;

    tp3 =
      entryPrice +
      risk * 3.0;

  } else {

    tp1 =
      entryPrice -
      risk * 1.5;

    tp2 =
      entryPrice -
      risk * 2.0;

    tp3 =
      entryPrice -
      risk * 3.0;
  }

  return {
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2,
    takeProfit3: tp3
  };
}


// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

export function analyzeMarketStructure(
  rawCandles
) {

  // ----------------------------------------------------------
  // 1. NORMALIZE CANDLES
  // ----------------------------------------------------------

  const candles =
    normalizeCandles(
      rawCandles
    );

  if (
    candles.length < 30
  ) {

    return {
      status: "INSUFFICIENT_DATA",
      message:
        "Not enough candles for market structure analysis.",
      candleCount:
        candles.length
    };
  }


  // ----------------------------------------------------------
  // 2. CURRENT PRICE
  // ----------------------------------------------------------

  const current =
    candles[candles.length - 1];

  const currentPrice =
    candleClose(current);


  // ----------------------------------------------------------
  // 3. MARKET STRUCTURE
  // ----------------------------------------------------------

  const structure =
    detectStructure(
      candles
    );


  // ----------------------------------------------------------
  // 4. LIQUIDITY SWEEP EVENTS
  // ----------------------------------------------------------

  const sweepEvents =
    detectSweepEvents(
      candles,
      structure
    );

  const latestSweep =
    sweepEvents.length
      ? sweepEvents[
          sweepEvents.length - 1
        ]
      : null;


  // ----------------------------------------------------------
  // 5. DISPLACEMENT
  // ----------------------------------------------------------

  const displacement =
    detectDisplacement(
      candles,
      sweepEvents
    );


  // ----------------------------------------------------------
  // 6. BOS / CHoCH
  // ----------------------------------------------------------

  const structureBreak =
    detectStructureBreak(
      candles,
      structure,
      displacement
    );


  // ----------------------------------------------------------
  // 7. LINKED FVG
  // ----------------------------------------------------------

  const fvg =
    detectLinkedFVG(
      candles,
      displacement
    );


  // ----------------------------------------------------------
  // 8. FVG INVALIDATION
  // ----------------------------------------------------------

  const fvgInvalidated =
    checkFVGInvalidation(
      candles,
      fvg
    );


  // ----------------------------------------------------------
  // 9. FVG RETEST
  // ----------------------------------------------------------

  const fvgRetest =
    detectFVGRetest(
      candles,
      fvg,
      fvgInvalidated
    );


  // ----------------------------------------------------------
  // 10. ENTRY TRIGGER
  // ----------------------------------------------------------

  const entryTrigger =
    detectEntryTrigger(
      candles,
      fvg,
      fvgRetest
    );


  // ----------------------------------------------------------
  // 11. SEQUENCE VALIDATION
  // ----------------------------------------------------------

  const sweepDirection =
    latestSweep
      ? latestSweep.direction
      : "NONE";

  const bullishSweep =
    latestSweep &&
    latestSweep.direction ===
      "BULLISH" &&
    latestSweep.rejection;

  const bearishSweep =
    latestSweep &&
    latestSweep.direction ===
      "BEARISH" &&
    latestSweep.rejection;


  const bullishDisplacement =
    displacement.detected &&
    displacement.direction ===
      "BULLISH" &&
    displacement.linkedSweep &&
    displacement.linkedSweep.direction ===
      "BULLISH";

  const bearishDisplacement =
    displacement.detected &&
    displacement.direction ===
      "BEARISH" &&
    displacement.linkedSweep &&
    displacement.linkedSweep.direction ===
      "BEARISH";


  const bullishStructureBreak =
    (
      structureBreak.bosDirection ===
        "BULLISH"
    ) ||
    (
      structureBreak.chochDirection ===
        "BULLISH"
    );

  const bearishStructureBreak =
    (
      structureBreak.bosDirection ===
        "BEARISH"
    ) ||
    (
      structureBreak.chochDirection ===
        "BEARISH"
    );


  const bullishFVG =
    fvg.detected &&
    fvg.direction ===
      "BULLISH" &&
    !fvgInvalidated;

  const bearishFVG =
    fvg.detected &&
    fvg.direction ===
      "BEARISH" &&
    !fvgInvalidated;


  const bullishRetest =
    fvgRetest.retest &&
    fvg.direction ===
      "BULLISH";

  const bearishRetest =
    fvgRetest.retest &&
    fvg.direction ===
      "BEARISH";


  // ----------------------------------------------------------
  // 12. COMPLETE SETUP
  // ----------------------------------------------------------

  const bullishSetup =
    bullishSweep &&
    bullishDisplacement &&
    bullishStructureBreak &&
    bullishFVG &&
    bullishRetest &&
    entryTrigger.confirmed &&
    entryTrigger.direction ===
      "BUY";

  const bearishSetup =
    bearishSweep &&
    bearishDisplacement &&
    bearishStructureBreak &&
    bearishFVG &&
    bearishRetest &&
    entryTrigger.confirmed &&
    entryTrigger.direction ===
      "SELL";


  // ----------------------------------------------------------
  // 13. CONFIRMATION SCORE
  // ----------------------------------------------------------

  let confirmationScore = 0;

  const maxConfirmationScore = 8;


  // Structure
  if (
    structure.trend ===
      "BULLISH" ||
    structure.trend ===
      "BEARISH"
  ) {
    confirmationScore++;
  }


  // Sweep
  if (
    bullishSweep ||
    bearishSweep
  ) {
    confirmationScore++;
  }


  // Displacement
  if (
    bullishDisplacement ||
    bearishDisplacement
  ) {
    confirmationScore++;
  }


  // BOS / CHoCH
  if (
    bullishStructureBreak ||
    bearishStructureBreak
  ) {
    confirmationScore++;
  }


  // FVG
  if (
    bullishFVG ||
    bearishFVG
  ) {
    confirmationScore++;
  }


  // FVG retest
  if (
    bullishRetest ||
    bearishRetest
  ) {
    confirmationScore++;
  }


  // Entry candle
  if (
    entryTrigger.confirmed
  ) {
    confirmationScore++;
  }


  // Direction alignment
  if (
    (
      bullishSetup &&
      structure.trend ===
        "BULLISH"
    ) ||
    (
      bearishSetup &&
      structure.trend ===
        "BEARISH"
    )
  ) {
    confirmationScore++;
  }


  const confirmationPercent =
    Math.round(
      (
        confirmationScore /
        maxConfirmationScore
      ) * 100
    );


  // ----------------------------------------------------------
  // 14. FINAL ENTRY
  // ----------------------------------------------------------

  let entry = {
    status: "WAITING",
    direction: "NONE",
    confirmed: false,
    price: null,
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    takeProfit3: null
  };


  if (
    bullishSetup
  ) {

    const risk =
      calculateRiskLevels(
        candles,
        "BUY",
        entryTrigger.price,
        latestSweep
      );

    entry = {
      status: "CONFIRMED",
      direction: "BUY",
      confirmed: true,
      price:
        entryTrigger.price,
      ...risk
    };

  } else if (
    bearishSetup
  ) {

    const risk =
      calculateRiskLevels(
        candles,
        "SELL",
        entryTrigger.price,
        latestSweep
      );

    entry = {
      status: "CONFIRMED",
      direction: "SELL",
      confirmed: true,
      price:
        entryTrigger.price,
      ...risk
    };
  }


  // ----------------------------------------------------------
  // 15. FINAL STATUS
  // ----------------------------------------------------------

  let status = "WAIT";

  if (
    bullishSetup
  ) {
    status = "BUY";
  }

  if (
    bearishSetup
  ) {
    status = "SELL";
  }


  // ----------------------------------------------------------
  // 16. LIQUIDITY OUTPUT
  // ----------------------------------------------------------

  let liquidityStatus =
    "NO SWEEP";

  if (
    latestSweep
  ) {

    liquidityStatus =
      latestSweep.direction ===
        "BULLISH"
        ? "CONFIRMED SELL-SIDE SWEEP"
        : "CONFIRMED BUY-SIDE SWEEP";
  }


  // ----------------------------------------------------------
  // 17. SEQUENCE OUTPUT
  // ----------------------------------------------------------

  const sequence = {

    sweep: latestSweep
      ? {
          detected: true,
          direction:
            latestSweep.direction,
          type:
            latestSweep.type,
          index:
            latestSweep.index,
          time:
            latestSweep.time,
          level:
            latestSweep.level,
          rejection:
            latestSweep.rejection
        }
      : {
          detected: false,
          direction: "NONE",
          type: null,
          index: null,
          time: null,
          level: null,
          rejection: false
        },

    displacement: {
      detected:
        displacement.detected,
      direction:
        displacement.direction,
      index:
        displacement.index,
      time:
        displacement.time,
      linkedToSweep:
        Boolean(
          displacement.linkedSweep
        )
    },

    structureBreak: {
      bos:
        structureBreak.bos,
      bosDirection:
        structureBreak.bosDirection,
      choch:
        structureBreak.choch,
      chochDirection:
        structureBreak.chochDirection,
      brokenLevel:
        structureBreak.brokenLevel,
      brokenLevelTime:
        structureBreak.brokenLevelTime
    },

    fvg: {
      detected:
        fvg.detected,
      direction:
        fvg.direction,
      index:
        fvg.index,
      time:
        fvg.time,
      retest:
        fvgRetest.retest,
      invalidated:
        fvgInvalidated
    },

    complete:
      bullishSetup ||
      bearishSetup
  };


  // ----------------------------------------------------------
  // 18. FINAL RESPONSE
  // ----------------------------------------------------------

  return {

    status,

    candleOrder:
      "ASCENDING",

    trend:
      structure.trend,

    structure:
      structure.structure,

    bos:
      structureBreak.bos,

    bosDirection:
      structureBreak.bosDirection,

    choch:
      structureBreak.choch,

    chochDirection:
      structureBreak.chochDirection,

    currentPrice,

    swingHigh:
      structure.swingHigh,

    swingLow:
      structure.swingLow,

    previousSwingHigh:
      structure.previousSwingHigh,

    previousSwingLow:
      structure.previousSwingLow,

    higherHigh:
      structure.higherHigh,

    higherLow:
      structure.higherLow,

    lowerHigh:
      structure.lowerHigh,

    lowerLow:
      structure.lowerLow,

    lastSwingHighTime:
      structure.lastSwingHigh
        ? structure.lastSwingHigh.time
        : null,

    lastSwingLowTime:
      structure.lastSwingLow
        ? structure.lastSwingLow.time
        : null,


    // --------------------------------------------------------
    // LIQUIDITY
    // --------------------------------------------------------

    liquidity: {

      status:
        liquidityStatus,

      buySideLiquidity:
        structure.swingHigh,

      sellSideLiquidity:
        structure.swingLow,

      previousBuySideLiquidity:
        structure.previousSwingHigh,

      previousSellSideLiquidity:
        structure.previousSwingLow,

      sweep:
        Boolean(latestSweep),

      sweepDirection,

      rejection:
        Boolean(
          latestSweep &&
          latestSweep.rejection
        ),

      rejectionDirection:
        latestSweep
          ? latestSweep.direction ===
              "BULLISH"
            ? "BULLISH"
            : "BEARISH"
          : "NONE",

      highSweep:
        Boolean(
          latestSweep &&
          latestSweep.direction ===
            "BEARISH"
        ),

      lowSweep:
        Boolean(
          latestSweep &&
          latestSweep.direction ===
            "BULLISH"
        ),

      bearishRejection:
        Boolean(
          latestSweep &&
          latestSweep.direction ===
            "BEARISH" &&
          latestSweep.rejection
        ),

      bullishRejection:
        Boolean(
          latestSweep &&
          latestSweep.direction ===
            "BULLISH" &&
          latestSweep.rejection
        ),

      upperWick:
        upperWick(current),

      lowerWick:
        lowerWick(current),

      candleRange:
        candleRange(current),

      candleBody:
        candleBody(current)
    },


    // --------------------------------------------------------
    // DISPLACEMENT
    // --------------------------------------------------------

    displacement: {

      status:
        displacement.detected
          ? "DISPLACEMENT DETECTED"
          : "NO DISPLACEMENT",

      detected:
        displacement.detected,

      direction:
        displacement.direction,

      time:
        displacement.time,

      index:
        displacement.index,

      candleBody:
        displacement.candleBody,

      averageBody:
        displacement.averageBody,

      threshold:
        displacement.threshold,

      multiplier:
        1.2,

      linkedToSweep:
        Boolean(
          displacement.linkedSweep
        )
    },


    // --------------------------------------------------------
    // FVG
    // --------------------------------------------------------

    fvg: {

      status:
        fvg.detected
          ? "RELEVANT FVG DETECTED"
          : "NO RELEVANT FVG",

      detected:
        fvg.detected,

      direction:
        fvg.direction,

      bullish:
        fvg.bullish,

      bearish:
        fvg.bearish,

      high:
        fvg.high,

      low:
        fvg.low,

      index:
        fvg.index,

      time:
        fvg.time,

      invalidated:
        fvgInvalidated,

      retest:
        fvgRetest.retest,

      position:
        fvgRetest.position
    },


    // --------------------------------------------------------
    // SETUP
    // --------------------------------------------------------

    setup: {

      status:
        bullishSetup ||
        bearishSetup
          ? "CONFIRMED"
          : "WAITING",

      direction:
        bullishSetup
          ? "BUY"
          : bearishSetup
            ? "SELL"
            : "NONE",

      bullishSetup,

      bearishSetup,

      sweepConfirmed:
        Boolean(
          latestSweep &&
          latestSweep.rejection
        ),

      displacementConfirmed:
        bullishDisplacement ||
        bearishDisplacement,

      structureBreakConfirmed:
        bullishStructureBreak ||
        bearishStructureBreak,

      fvgRetest:
        fvgRetest.retest,

      fvgInvalidated:
        fvgInvalidated
    },


    // --------------------------------------------------------
    // ENTRY
    // --------------------------------------------------------

    entry,


    // --------------------------------------------------------
    // SCORE
    // --------------------------------------------------------

    confirmationScore,

    maxConfirmationScore,

    confirmationPercent,

    validThreshold:
      confirmationPercent >= 75,


    // --------------------------------------------------------
    // DEBUG / SEQUENCE
    // --------------------------------------------------------

    sequence
  };
}
