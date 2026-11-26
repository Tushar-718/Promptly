import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

export const env = result.data;
