import { z } from 'zod'

const cartItemSchema = z.strictObject({
    productId: z.uuid().toLowerCase(),
    quantity: z.number().int().min(1).max(1000)
})

export const checkoutSchema = z
    .strictObject({
        customerId: z.uuid().toLowerCase().nullable().optional(),
        paymentMethod: z.literal('CASH'),
        items: z.array(cartItemSchema).min(1).max(50)
    })
    .superRefine((cart, ctx) => {
        const seen = new Set<string>()
        cart.items.forEach((item, index) => {
            if (seen.has(item.productId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['items', index, 'productId'],
                    message: 'Each product can appear only once in the cart'
                })
            }
            seen.add(item.productId)
        })
    })

export type CheckoutInput = z.infer<typeof checkoutSchema>
