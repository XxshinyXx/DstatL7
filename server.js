
import express from "express";
import morgan from "morgan";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(morgan("tiny"));
app.use(cors());
app.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use(express.static("public", { extensions: ["html"] }));

let totalRequests = 0;
let tsBuffer = [];
const WINDOW_MS = 60_000;
const clients = new Set();

app.use((req, res, next) => {
  if (req.path !== "/live") {
    totalRequests++;
    const now = Date.now();
    tsBuffer.push(now);
    const cutoff = now - WINDOW_MS;
    if (tsBuffer.length > 5000) tsBuffer = tsBuffer.filter(t => t >= cutoff);
  }
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

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
  send(res, compute());
  const hb = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { clearInterval(hb); clients.delete(client); });
});

function send(res, data) { res.write("event: metrics\n"); res.write("data: " + JSON.stringify(data) + "\n\n"); }
function broadcast(data) { for (const {res} of clients) try { send(res, data); } catch {} }
function compute() {
  const now = Date.now();
  const cutoff60 = now - WINDOW_MS;
  tsBuffer = tsBuffer.filter(t => t >= cutoff60);
  const rps = tsBuffer.filter(t => t >= now - 1000).length;
  const avg1m = tsBuffer.length / 60;
  return { t: now, total: totalRequests, rps, avg1m: Number(avg1m.toFixed(2)) };
}
setInterval(() => broadcast(compute()), 1000);

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log("L7 Live Traffic v3.2 on port " + PORT));
