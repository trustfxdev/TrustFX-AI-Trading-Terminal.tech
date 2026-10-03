import express from "express";
import cors from "cors";
import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const symbols = [
  "XAU/USD",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD",
  "USD/CAD"
];

let latestPrices = {};

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "TrustFX Live Market Backend"
  });
});

app.get("/prices", (req, res) => {
  res.json({
    status: "online",
    prices: latestPrices
  });
});

function connectTwelveData() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    console.log("Twelve Data API key is not configured.");
    return;
  }

  const ws = new WebSocket(
    `wss://ws.twelvedata.com/v1/quotes/price?apikey=${apiKey}`
  );

  ws.on("open", () => {
    console.log("Connected to Twelve Data.");

    ws.send(
      JSON.stringify({
        action: "subscribe",
        params: {
          symbols: symbols.join(",")
        }
      })
    );

    console.log("Subscribed to:", symbols.join(", "));
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.event === "price") {
        latestPrices[data.symbol] = {
          price: data.price,
          timestamp: data.timestamp
        };

        console.log(
          `${data.symbol}: ${data.price}`
        );
      }
    } catch (error) {
      console.log("Message error:", error.message);
    }
  });

  ws.on("error", (error) => {
    console.log("WebSocket error:", error.message);
  });

  ws.on("close", () => {
    console.log("Twelve Data connection closed.");
  });
}

app.listen(PORT, () => {
  console.log(`TrustFX backend running on port ${PORT}`);
  connectTwelveData();
});
