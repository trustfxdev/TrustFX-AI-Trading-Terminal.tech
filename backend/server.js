import express from "express";
import cors from "cors";
import WebSocket from "ws";
import dotenv from "dotenv";

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

const timeframes = [
  "1min",
  "5min",
  "15min",
  "1h",
  "4h",
  "1day"
];


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
    version: "2.0",
    marketData: "connected"
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
        message: "Twelve Data API key is not configured."
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

    const allowedIntervals = [
      "1min",
      "5min",
      "15min",
      "1h",
      "4h",
      "1day"
    ];

    if (!allowedIntervals.includes(interval)) {

      return res.status(400).json({
        status: "error",
        message: "Invalid timeframe."
      });

    }

    const symbolMap = {
      XAUUSD: "XAU/USD",
      EURUSD: "EUR/USD",
      GBPUSD: "GBP/USD",
      USDJPY: "USD/JPY",
      AUDUSD: "AUD/USD",
      USDCAD: "USD/CAD"
    };

    const symbol =
      symbolMap[requestedSymbol] ||
      requestedSymbol;


    const cacheKey =
      `${symbol}_${interval}_${outputsize}`;

    const cached =
      candleCache[cacheKey];


    /*
    Cache candles for 60 seconds.

    This prevents TrustFX from repeatedly
    requesting the same data.
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
        candles: cached.data
      });

    }


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
        message: data.message || "Twelve Data error"
      });

    }


    const values =
      Array.isArray(data.values)
        ? data.values
        : [];


    candleCache[cacheKey] = {
      timestamp: Date.now(),
      data: values
    };


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


  ws.on("error", (error) => {

    console.log(
      "WebSocket error:",
      error.message
    );

  });


  ws.on("close", () => {

    console.log(
      "Twelve Data connection closed."
    );


    /*
    Automatically reconnect after
    10 seconds.
    */

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

  connectTwelveData();

});
