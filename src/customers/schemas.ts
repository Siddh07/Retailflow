import { z } from 'zod'
import { pageQuery } from '../schemas/pagination.js'

const status = z.enum(['ACTIVE', 'PENDING', 'CLOSED'])

export const customerInput = z.strictObject({
    name: z.string().trim().min(1).max(100),
    email: z
        .string()
        .trim()
        .toLowerCase()
        .email()
        .max(254)
        .nullable()
        .optional(),
    phone: z
        .string()
        .trim()
        .regex(/^\d{10}$/)
        .nullable()
        .optional(),
    company: z.string().trim().min(1).max(100).nullable().optional(),
    status: status.optional()
})

export const customerPatch = customerInput
    .partial()
    .refine((input) => Object.keys(input).length > 0, {
        message: 'Provide at least one field to update'
    })

export const customerQuery = pageQuery.extend({
    search: z.string().trim().max(100).default(''),
    status: status.optional()
})

