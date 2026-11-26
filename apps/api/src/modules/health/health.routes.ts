import { sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../../db/client.js";

export const healthRouter = Router();

healthRouter.get("/", async (req, res) => {
  let dbOk = true;

  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    dbOk = false;
    req.log.error({ err }, "database health check failed");
  }

  res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk });
});
