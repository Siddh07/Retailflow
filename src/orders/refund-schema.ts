import { z } from 'zod'

export const refundSchema = z
    .strictObject({
        reason: z.string().trim().min(3).max(255),
        restock: z.boolean()
    })

export type RefundInput = z.infer<typeof refundSchema>
