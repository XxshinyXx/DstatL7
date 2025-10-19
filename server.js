import express from "express";
import morgan from "morgan";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(morgan("dev"));
app.use(cors());
app.use(express.static("public"));

// counter
let current = 0;
let history = [];

app.use((req, res, next) => {
  current++;
  next();
});

// send SSE updates of RPS
app.get("/stats", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders?.();

  const send = (count) => {
    res.write(`data: ${JSON.stringify({ t: Date.now(), count })}\n\n`);
  };

  const interval = setInterval(() => {
    const count = current;
    history.push({ t: Date.now(), count });
    if (history.length > 300) history.shift();
    current = 0;
    send(count);
  }, 1000);

  req.on("close", () => clearInterval(interval));
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log("Server running on", PORT));
