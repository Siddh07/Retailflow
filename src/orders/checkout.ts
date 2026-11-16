import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../errors/api-error.js'
import type { CheckoutInput } from './schemas.js'
import { calculateTotals, checkedMoney } from './pricing.js'

type ReceiptLine = {
    productId: string
    productName: string
    productSku: string
    unitPrice: number
    quantity: number
    lineTotal: number
}

export async function checkout(
    db: PrismaClient,
    cashierId: string,
    input: CheckoutInput
) {
    // All checkouts acquire product rows in the same order.
    const sortedItems = [...input.items].sort((a, b) =>
        a.productId.localeCompare(b.productId)
    )

    return db.$transaction(
        async (tx) => {
            const customerId = input.customerId ?? null
            if (customerId !== null) {
                const customer = await tx.customer.findUnique({
                    where: { id: customerId },
                    select: { id: true }
                })
                if (!customer) {
                    throw new ApiError(
                        404,
                        'CUSTOMER_NOT_FOUND',
                        'Customer not found'
                    )
                }
            }

            const lines: ReceiptLine[] = []

            for (const item of sortedItems) {
                const changed = await tx.product.updateMany({
                    where: {
                        id: item.productId,
                        isActive: true,
                        stockQuantity: { gte: item.quantity }
                    },
                    data: {
                        stockQuantity: { decrement: item.quantity }
                    }
                })

                if (changed.count !== 1) {
                    throw new ApiError(
                        409,
                        'PRODUCT_UNAVAILABLE',
                        `Product ${item.productId} is unavailable in the requested quantity`
                    )
                }

                const product = await tx.product.findUniqueOrThrow({
                    where: { id: item.productId },
                    select: {
                        id: true,
                        name: true,
                        sku: true,
                        price: true
                    }
                })

                lines.push({
                    productId: product.id,
                    productName: product.name,
                    productSku: product.sku,
                    unitPrice: product.price,
                    quantity: item.quantity,
                    lineTotal: checkedMoney(product.price * item.quantity)
                })
            }

            const totals = calculateTotals(lines.map((line) => line.lineTotal))

            const order = await tx.order.create({
                data: {
                    orderNumber: `RF-${randomUUID()}`,
                    cashierId,
                    customerId,
                    paymentMethod: input.paymentMethod,
                    status: 'COMPLETED',
                    ...totals,
                    items: {
                        create: lines
                    }
                },
                include: {
                    items: {
                        orderBy: { productId: 'asc' }
                    }
                }
            })

            await tx.inventoryMovement.createMany({
                data: lines.map((line) => ({
                    productId: line.productId,
                    actorId: cashierId,
                    orderId: order.id,
                    kind: 'SALE' as const,
                    delta: -line.quantity,
                    reason: `Sale ${order.orderNumber}`
                }))
            })

            return order
        },
        { isolationLevel: 'ReadCommitted' }
    )
}
