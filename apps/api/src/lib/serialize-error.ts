import { DrizzleQueryError } from "drizzle-orm";
import pino from "pino";

type DbCause = {
  severity?: string; // only set on errors sent by the Postgres server
  message?: string;
  code?: string;
  table?: string;
  column?: string;
  constraint?: string;
};

export function serializeError(err: Error) {
  if (!(err instanceof DrizzleQueryError)) return pino.stdSerializers.err(err);

  const cause = (err.cause ?? {}) as DbCause;

  // Allowlist: log only the fields chosen here
  return {
    type: "DrizzleQueryError",
    query: err.query, // SQL with $1, $2 placeholders
    stack: err.stack?.split(err.message)[1], // file locations only
    cause: {
      code: cause.code,
      table: cause.table,
      column: cause.column,
      constraint: cause.constraint,
      // Postgres server messages can quote input; keep only other messages, such as connection errors
      message: cause.severity ? undefined : cause.message,
    },
  };
}
