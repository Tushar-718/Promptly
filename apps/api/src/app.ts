import express from "express";

import { requestId } from "./middleware/request-id.js";
import { httpLogger } from "./middleware/http-logger.js";
import { notFound } from "./middleware/not-found.js";
import { errorHandler } from "./middleware/error-handler.js";

export const app = express();

// Middleware
app.use(requestId);
app.use(httpLogger);
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API is healthy",
  });
});

app.use(notFound);
app.use(errorHandler);
