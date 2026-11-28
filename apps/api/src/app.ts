import express from "express";

import { requestId } from "./middleware/request-id.js";
import { httpLogger } from "./middleware/http-logger.js";
import { notFound } from "./middleware/not-found.js";
import { errorHandler } from "./middleware/error-handler.js";
import { apiRouter } from "./routes/index.js";

export const app = express();

// Middleware
app.use(requestId);
app.use(httpLogger);
app.use(express.json());

// All API routes
app.use("/api/v1", apiRouter);

app.use(notFound);
app.use(errorHandler);
