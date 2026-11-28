import { pinoHttp, stdSerializers } from "pino-http";
import { logger } from "../lib/logger.js";
import { serializeError } from "../lib/serialize-error.js";

export const httpLogger = pinoHttp({
  logger,

  genReqId: (req) => req.id,

  // pino-http has its own serializers, which override the logger's.
  // wrapSerializers: false gives serializeError the original error object.
  wrapSerializers: false,
  serializers: {
    req: stdSerializers.req,
    res: stdSerializers.res,
    err: serializeError,
  },

  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    censor: "[REDACTED]",
  },
});
