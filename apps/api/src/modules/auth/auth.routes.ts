import { Router } from "express";

import { registerSchema } from "@promptly/shared";
import { validateBody } from "../../middleware/validate.js";
import { registerController } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", validateBody(registerSchema), registerController);
