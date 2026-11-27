import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),

  password: z.string().min(8).max(72),

  name: z.string().trim().min(1).max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;
