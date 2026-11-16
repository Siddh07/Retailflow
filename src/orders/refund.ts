import { type PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../errors/api-error.js'
import type { RefundInput } from './refund-schema.js'

const MAX_STOCK = 1_000_000

export async function refundOrder(
    db: PrismaClient,
    orderId: string,
    actorId: string,
    input: RefundInput
) {
    return db.$transaction(
        async (tx) => {
            const order = await tx.order.findUnique({
                where: { id: orderId },
                include: {
                    items: {
                        orderBy: { productId: 'asc' }
                    }
                }
            })

            if (!order) {
                throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found')
            }

            if (order.status === 'REFUNDED') {
                throw new ApiError(409, 'ORDER_ALREADY_REFUNDED', 'Order has already been refunded')
            }

            if (order.status !== 'COMPLETED') {
                throw new ApiError(400, 'ORDER_NOT_REFUNDABLE', 'Order is not in a refundable state')
            }

            const updatedOrder = await tx.order.updateMany({
                where: {
                    id: orderId,
                    status: 'COMPLETED'
                },
                data: {
                    status: 'REFUNDED'
                }
            })

            if (updatedOrder.count === 0) {
                throw new ApiError(409, 'ORDER_ALREADY_REFUNDED', 'Order has already been refunded')
            }

            if (input.restock) {
                for (const line of order.items) {
                    const changed = await tx.product.updateMany({
                        where: {
                            id: line.productId,
                            stockQuantity: { lte: MAX_STOCK - line.quantity }
                        },
                        data: {
                            stockQuantity: { increment: line.quantity }
                        }
                    })

                    if (changed.count !== 1) {
                        throw new ApiError(
                            409,
                            'RESTOCK_LIMIT',
                            `Restocking product ${line.productId} would exceed the maximum stock limit`
                        )
                    }

                    await tx.inventoryMovement.create({
                        data: {
                            productId: line.productId,
                            delta: line.quantity,
                            kind: 'REFUND_RESTOCK',
                            reason: `Refund restock for order ${order.orderNumber}: ${input.reason}`,
                            actorId,
                            orderId: order.id
                        }
                    })
                }
            }

            const refund = await tx.refund.create({
                data: {
                    orderId: order.id,
                    actorId,
                    amount: order.total,
                    reason: input.reason,
                    restocked: input.restock
                }
            })

            await tx.auditEvent.create({
                data: {
                    action: 'ORDER_REFUNDED',
                    actorId,
                    orderId: order.id,
                    metadata: {
                        refundId: refund.id,
                        amount: refund.amount,
                        reason: refund.reason,
                        restocked: refund.restocked
                    }
                }
            })

            return refund
        },
        { isolationLevel: 'ReadCommitted' }
    )
}
