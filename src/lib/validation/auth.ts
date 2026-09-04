import { z } from "zod";

/** bcrypt only uses the first 72 bytes — cap to avoid silent truncation. */
const PASSWORD_MAX = 72;

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(80, "Name is too long"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .max(255)
    .transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(PASSWORD_MAX, "Password is too long"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .max(255)
    .transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(1, "Password is required")
    .max(PASSWORD_MAX, "Password is too long"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
