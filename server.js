import express from "express";
import morgan from "morgan";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(morgan("tiny"));
app.use(cors());
app.use(express.static("public", { extensions: ["html"] }));

// ----- Metrics state -----
let totalRequests = 0;
let tsBuffer = []; // timestamps (ms) for last 60s
const WINDOW_MS = 60_000;

// SSE clients
const clients = new Set();

// Middleware: record every incoming request (excluding SSE pings to reduce self-noise if desired)
app.use((req, res, next) => {
  if (req.path !== "/live") {
    totalRequests++;
    const now = Date.now();
    tsBuffer.push(now);
    const cutoff = now - WINDOW_MS;
    if (tsBuffer.length > 5000) {
      tsBuffer = tsBuffer.filter(t => t >= cutoff);
    }
  }
  next();
});

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ----- SSE stream for live metrics -----
app.get("/live", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();

  const client = { res };
  clients.add(client);

  // Send a welcome snapshot immediately
  const snap = computeMetrics();
  sendEvent(res, "metrics", snap);

  // Heartbeat to keep proxies happy
  const hb = setInterval(() => { res.write(": ping\n\n"); }, 15000);

  req.on("close", () => {
    clearInterval(hb);
    clients.delete(client);
  });
});

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const { res } of clients) {
    try { sendEvent(res, event, data); } catch {}
  }
}

function computeMetrics() {
  const now = Date.now();
  const cutoff60 = now - WINDOW_MS;
  tsBuffer = tsBuffer.filter(t => t >= cutoff60);

  const rpsCutoff = now - 1000;
  let currentRps = 0;
  for (let i = tsBuffer.length - 1; i >= 0; i--) {
    if (tsBuffer[i] >= rpsCutoff) currentRps++; else break;
  }

  const lastMinuteCount = tsBuffer.length;
  const avg1m = lastMinuteCount / 60;

  return { t: now, total: totalRequests, rps: currentRps, avg1m: Number(avg1m.toFixed(2)) };
}

setInterval(() => {
  const m = computeMetrics();
  broadcast("metrics", m);
}, 1000);

// Fallback SPA route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log("L7 Live Traffic v3 listening on :" + PORT));
