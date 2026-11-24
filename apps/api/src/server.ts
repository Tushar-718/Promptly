import express from "express";
import { env } from "./config/env.js";

const app = express();

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
