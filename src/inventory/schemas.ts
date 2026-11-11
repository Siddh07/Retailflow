import { z } from 'zod'

export const adjustmentSchema = z
    .strictObject({
        kind: z.enum(['RECEIPT', 'CORRECTION']),
        delta: z.number().int().min(-1_000_000).max(1_000_000),
        reason: z.string().trim().min(1).max(200)
    })
    .superRefine((input, ctx) => {
        if (input.delta === 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['delta'],
                message: 'Quantity change must be nonzero'
            })
        }

        if (input.kind === 'RECEIPT' && input.delta < 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['delta'],
                message: 'A receipt must increase stock'
            })
        }
    })

export type Adjustment = z.infer<typeof adjustmentSchema>

