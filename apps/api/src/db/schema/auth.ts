import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.provider, table.providerAccountId)],
);
