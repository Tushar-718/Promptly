import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server is running");
});
