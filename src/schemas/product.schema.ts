import { z } from 'zod'

export const productIdSchema = z.uuid()

export const createProductSchema = z.strictObject({
    name: z.string().trim().min(1).max(100),

    sku: z
        .string()
        .trim()
        .toUpperCase()
        .min(1)
        .max(30)
        .regex(/^[A-Z0-9-]+$/, {
            message: 'SKU can contain only letters, numbers, and hyphens'
        }),

    price: z.number().int().min(0).max(1_000_000_000),

    stockQuantity: z.number().int().min(0).max(1_000_000),

    lowStockThreshold: z.number().int().min(0).max(1_000_000).optional()
})

export const updateProductSchema = createProductSchema
    .omit({ stockQuantity: true })
    .partial()
    .refine((data) => Object.keys(data).length > 0, {
        message: 'Provide at least one editable field'
    })

const positiveIntegerQuery = z
    .string()
    .regex(/^[1-9]\d*$/, {
        message: 'Must be a positive integer'
    })
    .transform(Number)
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))

export const listProductsQuerySchema = z.strictObject({
    search: z.string().trim().max(100).default(''),

    page: positiveIntegerQuery.default(1),

    limit: positiveIntegerQuery
        .pipe(z.number().max(100))
        .default(10),

    sortBy: z
        .enum(['name', 'price', 'stockQuantity'])
        .default('name'),

    order: z.enum(['asc', 'desc']).default('asc')
})

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>
