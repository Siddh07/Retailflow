import { z } from 'zod'

export const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)

export const newPasswordSchema = z
    .string()
    .min(15)
    .max(128)

export const loginSchema = z.strictObject({
    email: emailSchema,
    password: z.string().min(1).max(128)
})

export const createEmployeeSchema = z.strictObject({
    email: emailSchema,
    password: newPasswordSchema,
    role: z.enum(['ADMIN', 'CASHIER']).default('CASHIER')
})