import express from "express";
import cors from "cors";
import WebSocket from "ws";
import dotenv from "dotenv";
import { analyzeMarketStructure } from "./analysis.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const API_KEY = process.env.TWELVE_DATA_API_KEY;

const TWELVE_DATA_BASE = "https://api.twelvedata.com";

/*
=========================================================
TRUSTFX SUPPORTED MARKETS
=========================================================
*/

const symbols = [
  "XAU/USD",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD",
  "USD/CAD"
];

/*
=========================================================
LIVE PRICE STORAGE
=========================================================
*/

let latestPrices = {};

/*
=========================================================
CANDLE CACHE
=========================================================
*/

const candleCache = {};

/*
=========================================================
SUPPORTED TIMEFRAMES
=========================================================
*/

const allowedIntervals = [
  "1min",
  "5min",
  "15min",
  "1h",
  "4h",
  "1day"
];

/*
=========================================================
SYMBOL MAP
=========================================================
*/

const symbolMap = {
  XAUUSD: "XAU/USD",
  "XAU/USD": "XAU/USD",

  EURUSD: "EUR/USD",
  "EUR/USD": "EUR/USD",

  GBPUSD: "GBP/USD",
  "GBP/USD": "GBP/USD",

  USDJPY: "USD/JPY",
  "USD/JPY": "USD/JPY",

  AUDUSD: "AUD/USD",
  "AUD/USD": "AUD/USD",

  USDCAD: "USD/CAD",
  "USD/CAD": "USD/CAD"
};

/*
=========================================================
NORMALIZE SYMBOL
=========================================================
*/

function normalizeSymbol(requestedSymbol) {
  const normalized = String(requestedSymbol || "")
    .trim()
    .toUpperCase();

  return symbolMap[normalized] || null;
}

/*
=========================================================
HEALTH CHECK
=========================================================
*/

app.get("/healthz", (req, res) => {
  res.json({
    status: "healthy",
    service: "TrustFX AI Trading Backend",
    timestamp: new Date().toISOString()
  });
});

/*
=========================================================
MAIN STATUS
=========================================================
*/

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "TrustFX Live Market Backend",
    version: "3.1",
    marketData: API_KEY ? "configured" : "not_configured",
    engines: [
      "Live Prices",
      "Candles",
      "Market Structure"
    ],
    supportedSymbols: symbols,
    supportedIntervals: allowedIntervals
  });
});

/*
=========================================================
LIVE PRICES
=========================================================
*/

app.get("/prices", (req, res) => {
  res.json({
    status: "online",
    prices: latestPrices,
    count: Object.keys(latestPrices).length,
    timestamp: new Date().toISOString()
  });
});

/*
=========================================================
GET CANDLES
=========================================================
*/

app.get("/candles/:symbol", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        status: "error",
        message: "Twelve Data API key is not configured."
      });
    }

    /*
    -------------------------------------------------------
    SYMBOL
    -------------------------------------------------------
    */

    const symbol = normalizeSymbol(req.params.symbol);

    if (!symbol) {
      return res.status(400).json({
        status: "error",
        message: "Unsupported trading symbol.",
        supportedSymbols: symbols
      });
    }

    /*
    -------------------------------------------------------
    TIMEFRAME
    -------------------------------------------------------
    */

    const interval = String(
      req.query.interval || "15min"
    );

    if (!allowedIntervals.includes(interval)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid timeframe.",
        allowedIntervals
      });
    }

    /*
    -------------------------------------------------------
    OUTPUT SIZE
    -------------------------------------------------------
    */

    const requestedOutputsize = Number(
      req.query.outputsize
    );

    const outputsize = Number.isFinite(requestedOutputsize)
      ? Math.max(
          1,
          Math.min(Math.floor(requestedOutputsize), 500)
        )
      : 100;

    /*
    -------------------------------------------------------
    CACHE KEY
    -------------------------------------------------------
    */

    const cacheKey =
      `${symbol}_${interval}_${outputsize}`;

    const cached = candleCache[cacheKey];

    /*
    -------------------------------------------------------
    RETURN CACHED CANDLES
    -------------------------------------------------------
    */

    if (
      cached &&
      Date.now() - cached.timestamp < 60000
    ) {
      return res.json({
        status: "online",
        source: "cache",
        symbol,
        interval,
        count: cached.data.length,
        candles: cached.data
      });
    }

    /*
    -------------------------------------------------------
    REQUEST TWELVE DATA
    -------------------------------------------------------
    */

    const url =
      `${TWELVE_DATA_BASE}/time_series` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&outputsize=${outputsize}` +
      `&apikey=${encodeURIComponent(API_KEY)}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Twelve Data HTTP ${response.status}`
      );
    }

    const data = await response.json();

    /*
    -------------------------------------------------------
    CHECK API ERRORS
    -------------------------------------------------------
    */

    if (
      data.status === "error" ||
      data.code
    ) {
      return res.status(400).json({
        status: "error",
        message:
          data.message || "Twelve Data returned an error."
      });
    }

    /*
    -------------------------------------------------------
    EXTRACT CANDLES
    -------------------------------------------------------
    */

    const values = Array.isArray(data.values)
      ? data.values
      : [];

    if (values.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "No candle data returned.",
        symbol,
        interval
      });
    }

    /*
    -------------------------------------------------------
    SAVE CACHE
    -------------------------------------------------------
    */

    candleCache[cacheKey] = {
      timestamp: Date.now(),
      data: values
    };

    /*
    -------------------------------------------------------
    RETURN CANDLES
    -------------------------------------------------------
    */

    return res.json({
      status: "online",
      source: "Twelve Data",
      symbol,
      interval,
      count: values.length,
      candles: values
    });

  } catch (error) {
    console.error(
      "Candle error:",
      error.message
    );

    return res.status(500).json({
      status: "error",
      message: "Unable to retrieve candle data.",
      detail: error.message
    });
  }
});

/*
=========================================================
TRUSTFX MARKET STRUCTURE ANALYSIS
=========================================================
*/

app.get("/analysis/:symbol", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        status: "error",
        message: "Twelve Data API key is not configured."
      });
    }

    /*
    -------------------------------------------------------
    NORMALIZE SYMBOL
    -------------------------------------------------------
    */

    const symbol = normalizeSymbol(req.params.symbol);

    if (!symbol) {
      return res.status(400).json({
        status: "error",
        message: "Unsupported trading symbol.",
        supportedSymbols: symbols
      });
    }

    /*
    -------------------------------------------------------
    GET TIMEFRAME
    -------------------------------------------------------
    */

    const interval = String(
      req.query.interval || "15min"
    );

    if (!allowedIntervals.includes(interval)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid timeframe.",
        allowedIntervals
      });
    }

    /*
    -------------------------------------------------------
    ANALYSIS CANDLE COUNT
    -------------------------------------------------------
    */

    const outputsize = 100;

    /*
    -------------------------------------------------------
    CHECK SHARED CANDLE CACHE
    -------------------------------------------------------
    */

    const cacheKey =
      `${symbol}_${interval}_${outputsize}`;

    let candles = null;

    const cached = candleCache[cacheKey];

    if (
      cached &&
      Date.now() - cached.timestamp < 60000
    ) {
      candles = cached.data;
    }

    /*
    -------------------------------------------------------
    FETCH CANDLES IF NOT CACHED
    -------------------------------------------------------
    */

    if (!candles) {
      const url =
        `${TWELVE_DATA_BASE}/time_series` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&interval=${encodeURIComponent(interval)}` +
        `&outputsize=${outputsize}` +
        `&apikey=${encodeURIComponent(API_KEY)}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Twelve Data HTTP ${response.status}`
        );
      }

      const data = await response.json();

      if (
        data.status === "error" ||
        data.code
      ) {
        return res.status(400).json({
          status: "error",
          message:
            data.message || "Twelve Data returned an error."
        });
      }

      candles = Array.isArray(data.values)
        ? data.values
        : [];

      if (candles.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "No candle data available for analysis.",
          symbol,
          interval
        });
      }

      /*
      -----------------------------------------------------
      SAVE CANDLES TO SHARED CACHE
      -----------------------------------------------------
      */

      candleCache[cacheKey] = {
        timestamp: Date.now(),
        data: candles
      };
    }

    /*
    -------------------------------------------------------
    RUN MARKET STRUCTURE ENGINE
    -------------------------------------------------------
    IMPORTANT FIX:
    Pass the symbol and interval to the analysis engine.
    -------------------------------------------------------
    */

    const analysis = analyzeMarketStructure(candles, {
      symbol,
      interval
    });

    /*
    -------------------------------------------------------
    RETURN ANALYSIS
    -------------------------------------------------------
    */

    return res.json({
      status: "online",
      engine: "TRUSTFX Market Structure Engine",
      version: "1.0",
      symbol,
      interval,
      candleCount: candles.length,
      analysis
    });

  } catch (error) {
    console.error(
      "Analysis error:",
      error.message
    );

    return res.status(500).json({
      status: "error",
      message: "Unable to analyze market structure.",
      detail: error.message
    });
  }
});

/*
=========================================================
TWELVE DATA WEBSOCKET
=========================================================
*/

let reconnectTimer = null;
let reconnectDelay = 10000;

function connectTwelveData() {
  if (!API_KEY) {
    console.log(
      "Twelve Data API key is not configured."
    );

    return;
  }

  /*
  -------------------------------------------------------
  CREATE WEBSOCKET CONNECTION
  -------------------------------------------------------
  */

  const ws = new WebSocket(
    `wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(API_KEY)}`
  );

  /*
  -------------------------------------------------------
  CONNECTION OPEN
  -------------------------------------------------------
  */

  ws.on("open", () => {
    console.log(
      "Connected to Twelve Data WebSocket."
    );

    reconnectDelay = 10000;

    ws.send(
      JSON.stringify({
        action: "subscribe",
        params: {
          symbols: symbols.join(",")
        }
      })
    );

    console.log(
      "Subscribed to:",
      symbols.join(", ")
    );
  });

  /*
  -------------------------------------------------------
  LIVE PRICE MESSAGE
  -------------------------------------------------------
  */

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(
        message.toString()
      );

      if (
        data.event === "price" &&
        data.symbol &&
        data.price !== undefined
      ) {
        latestPrices[data.symbol] = {
          price: Number(data.price),
          timestamp: data.timestamp || Date.now()
        };
      }

      if (data.event === "subscribe-status") {
        console.log(
          "Twelve Data subscription status:",
          JSON.stringify(data)
        );
      }

      if (data.event === "error") {
        console.error(
          "Twelve Data WebSocket message error:",
          JSON.stringify(data)
        );
      }

    } catch (error) {
      console.error(
        "WebSocket message error:",
        error.message
      );
    }
  });

  /*
  -------------------------------------------------------
  WEBSOCKET ERROR
  -------------------------------------------------------
  */

  ws.on("error", (error) => {
    console.error(
      "WebSocket error:",
      error.message
    );
  });

  /*
  -------------------------------------------------------
  AUTOMATIC RECONNECT
  -------------------------------------------------------
  */

  ws.on("close", () => {
    console.log(
      "Twelve Data WebSocket connection closed."
    );

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    console.log(
      `Reconnecting in ${reconnectDelay / 1000} seconds...`
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectTwelveData();
    }, reconnectDelay);

    reconnectDelay = Math.min(
      reconnectDelay * 2,
      60000
    );
  });
}

/*
=========================================================
START SERVER
=========================================================
*/

app.listen(PORT, () => {
  console.log(
    `TrustFX backend running on port ${PORT}`
  );

  console.log(
    "TrustFX candle engine ready."
  );

  console.log(
    "TrustFX market structure engine ready."
  );

  connectTwelveData();
});
