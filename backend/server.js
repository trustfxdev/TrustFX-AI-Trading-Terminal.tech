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

const TWELVE_DATA_BASE =
  "https://api.twelvedata.com";

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
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  AUDUSD: "AUD/USD",
  USDCAD: "USD/CAD"
};


/*
=========================================================
HEALTH CHECK
=========================================================
*/

app.get("/healthz", (req, res) => {

  res.json({
    status: "healthy",
    service: "TrustFX AI Trading Backend"
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
    version: "3.0",
    marketData: "connected",
    engines: [
      "Live Prices",
      "Candles",
      "Market Structure"
    ]
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
    prices: latestPrices
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
        message:
          "Twelve Data API key is not configured."
      });

    }


    const requestedSymbol =
      req.params.symbol.toUpperCase();


    const interval =
      req.query.interval || "15min";


    const outputsize =
      Math.min(
        Number(req.query.outputsize) || 100,
        500
      );


    /*
    -------------------------------------------------------
    VALIDATE TIMEFRAME
    -------------------------------------------------------
    */

    if (!allowedIntervals.includes(interval)) {

      return res.status(400).json({
        status: "error",
        message: "Invalid timeframe.",
        allowedIntervals
      });

    }


    /*
    -------------------------------------------------------
    CONVERT SYMBOL
    -------------------------------------------------------
    */

    const symbol =
      symbolMap[requestedSymbol] ||
      requestedSymbol;


    /*
    -------------------------------------------------------
    CACHE KEY
    -------------------------------------------------------
    */

    const cacheKey =
      `${symbol}_${interval}_${outputsize}`;


    const cached =
      candleCache[cacheKey];


    /*
    -------------------------------------------------------
    RETURN CACHE
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
    TWELVE DATA REQUEST
    -------------------------------------------------------
    */

    const url =
      `${TWELVE_DATA_BASE}/time_series` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&outputsize=${outputsize}` +
      `&apikey=${encodeURIComponent(API_KEY)}`;


    const response =
      await fetch(url);


    if (!response.ok) {

      throw new Error(
        `Twelve Data HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    /*
    -------------------------------------------------------
    CHECK TWELVE DATA ERROR
    -------------------------------------------------------
    */

    if (data.status === "error") {

      return res.status(400).json({

        status: "error",

        message:
          data.message ||
          "Twelve Data error"

      });

    }


    /*
    -------------------------------------------------------
    EXTRACT CANDLES
    -------------------------------------------------------
    */

    const values =
      Array.isArray(data.values)
        ? data.values
        : [];


    if (values.length === 0) {

      return res.status(404).json({

        status: "error",

        message:
          "No candle data returned."

      });

    }


    /*
    -------------------------------------------------------
    SAVE TO CACHE
    -------------------------------------------------------
    */

    candleCache[cacheKey] = {

      timestamp: Date.now(),

      data: values

    };


    /*
    -------------------------------------------------------
    SEND RESPONSE
    -------------------------------------------------------
    */

    res.json({

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


    res.status(500).json({

      status: "error",

      message:
        "Unable to retrieve candle data.",

      detail:
        error.message

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

        message:
          "Twelve Data API key is not configured."

      });

    }


    /*
    -------------------------------------------------------
    SYMBOL
    -------------------------------------------------------
    */

    const requestedSymbol =
      req.params.symbol.toUpperCase();


    const symbol =
      symbolMap[requestedSymbol] ||
      requestedSymbol;


    /*
    -------------------------------------------------------
    TIMEFRAME
    -------------------------------------------------------
    */

    const interval =
      req.query.interval || "15min";


    if (!allowedIntervals.includes(interval)) {

      return res.status(400).json({

        status: "error",

        message:
          "Invalid timeframe.",

        allowedIntervals

      });

    }


    /*
    -------------------------------------------------------
    ANALYSIS NEEDS ENOUGH CANDLES
    -------------------------------------------------------
    */

    const outputsize = 100;


    /*
    -------------------------------------------------------
    USE SAME CANDLE CACHE
    -------------------------------------------------------
    */

    const cacheKey =
      `${symbol}_${interval}_${outputsize}`;


    let candles = null;


    const cached =
      candleCache[cacheKey];


    if (
      cached &&
      Date.now() - cached.timestamp < 60000
    ) {

      candles =
        cached.data;

    }


    /*
    -------------------------------------------------------
    GET FRESH CANDLES IF CACHE EMPTY
    -------------------------------------------------------
    */

    if (!candles) {

      const url =
        `${TWELVE_DATA_BASE}/time_series` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&interval=${encodeURIComponent(interval)}` +
        `&outputsize=${outputsize}` +
        `&apikey=${encodeURIComponent(API_KEY)}`;


      const response =
        await fetch(url);


      if (!response.ok) {

        throw new Error(
          `Twelve Data HTTP ${response.status}`
        );

      }


      const data =
        await response.json();


      if (data.status === "error") {

        return res.status(400).json({

          status: "error",

          message:
            data.message ||
            "Twelve Data error"

        });

      }


      candles =
        Array.isArray(data.values)
          ? data.values
          : [];


      if (candles.length === 0) {

        return res.status(404).json({

          status: "error",

          message:
            "No candle data available for analysis."

        });

      }


      /*
      -----------------------------------------------------
      SAVE TO SAME CACHE
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
    */

    const analysis =
      analyzeMarketStructure(candles);


    /*
    -------------------------------------------------------
    RETURN ANALYSIS
    -------------------------------------------------------
    */

    res.json({

      status: "online",

      engine:
        "TRUSTFX Market Structure Engine",

      version: "1.0",

      symbol,

      interval,

      candleCount:
        candles.length,

      analysis

    });


  } catch (error) {

    console.error(
      "Analysis error:",
      error.message
    );


    res.status(500).json({

      status: "error",

      message:
        "Unable to analyze market structure.",

      detail:
        error.message

    });

  }

});


/*
=========================================================
TWELVE DATA WEBSOCKET
=========================================================
*/

function connectTwelveData() {

  if (!API_KEY) {

    console.log(
      "Twelve Data API key is not configured."
    );

    return;

  }


  const ws =
    new WebSocket(
      `wss://ws.twelvedata.com/v1/quotes/price?apikey=${API_KEY}`
    );


  /*
  -------------------------------------------------------
  CONNECTION OPEN
  -------------------------------------------------------
  */

  ws.on("open", () => {

    console.log(
      "Connected to Twelve Data."
    );


    ws.send(
      JSON.stringify({

        action: "subscribe",

        params: {

          symbols:
            symbols.join(",")

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

      const data =
        JSON.parse(
          message.toString()
        );


      if (data.event === "price") {

        latestPrices[data.symbol] = {

          price:
            data.price,

          timestamp:
            data.timestamp

        };


        console.log(
          `${data.symbol}: ${data.price}`
        );

      }

    } catch (error) {

      console.log(
        "Message error:",
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

    console.log(
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
      "Twelve Data connection closed."
    );


    console.log(
      "Attempting to reconnect in 10 seconds..."
    );


    setTimeout(
      connectTwelveData,
      10000
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
