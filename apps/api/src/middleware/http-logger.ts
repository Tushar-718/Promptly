import { pinoHttp } from "pino-http";
import { logger } from "../lib/logger.js";

export const httpLogger = pinoHttp({
  logger,

  genReqId: (req) => req.id,

  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    censor: "[REDACTED]",
  },
});
