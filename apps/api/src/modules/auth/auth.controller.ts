import type { Request, Response } from "express";
import { register } from "./auth.service.js";

export async function registerController(req: Request, res: Response) {
  const user = await register(req.body);

  return res.status(201).json({ user });
}
