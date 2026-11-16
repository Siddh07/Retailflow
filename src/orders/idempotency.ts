import { createHash } from 'node:crypto'
import type { CheckoutInput } from './schemas.js'

export function hashCheckoutPayload(input: CheckoutInput): string {
    const canonical = {
        customerId: input.customerId ?? null,
        paymentMethod: input.paymentMethod,
        items: [...input.items]
            .sort((a, b) => a.productId.localeCompare(b.productId))
            .map((item) => ({
                productId: item.productId,
                quantity: item.quantity
            }))
    }

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
