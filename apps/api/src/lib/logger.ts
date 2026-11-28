import pino from "pino";
import { env } from "../config/env.js";
import { serializeError } from "./serialize-error.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  serializers: { err: serializeError },
});
