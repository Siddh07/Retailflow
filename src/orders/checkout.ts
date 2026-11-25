import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../errors/api-error.js'
import type { CheckoutInput } from './schemas.js'
import { calculateTotals, checkedMoney } from './pricing.js'
import { hashCheckoutPayload } from './idempotency.js'

type ReceiptLine = {
    productId: string
    productName: string
    productSku: string
    unitPrice: number
    quantity: number
    lineTotal: number
}

async function createSale(
    tx: Prisma.TransactionClient,
    cashierId: string,
    input: CheckoutInput
) {
    const sortedItems = [...input.items].sort((a, b) =>
        a.productId.localeCompare(b.productId)
    )

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
}

export type OrderReceipt = Awaited<ReturnType<typeof createSale>>

export async function checkout(
    db: PrismaClient,
    cashierId: string,
    key: string,
    input: CheckoutInput
): Promise<{ receipt: OrderReceipt; replayed: boolean }> {
    const requestHash = hashCheckoutPayload(input)

    return db.$transaction(
        async (tx) => {
            const claim = await tx.checkoutAttempt.createMany({
                data: [{ cashierId, key, requestHash }],
                skipDuplicates: true
            })

            if (claim.count === 0) {
                const existing = await tx.checkoutAttempt.findUnique({
                    where: { cashierId_key: { cashierId, key } }
                })

                if (!existing) {
                    throw new ApiError(
                        409,
                        'CONCURRENCY_CONFLICT',
                        'Please retry checkout'
                    )
                }

                if (existing.requestHash !== requestHash) {
                    throw new ApiError(
                        409,
                        'IDEMPOTENCY_KEY_REUSED',
                        'Idempotency key was already used with a different cart or customer'
                    )
                }

                if (!existing.receiptJson) {
                    throw new ApiError(
                        409,
                        'IDEMPOTENCY_IN_FLIGHT',
                        'A checkout with this key is currently processing. Please wait and retry.'
                    )
                }

                return {
                    receipt: existing.receiptJson as unknown as OrderReceipt,
                    replayed: true
                }
            }

            const receipt = await createSale(tx, cashierId, input)

            await tx.auditEvent.create({
                data: {
                    action: 'CHECKOUT_COMPLETED',
                    actorId: cashierId,
                    orderId: receipt.id,
                    metadata: {
                        grandTotal: receipt.total,
                        itemCount: receipt.items.length,
                        paymentMethod: receipt.paymentMethod
                    }
                }
            })

            await tx.checkoutAttempt.update({
                where: { cashierId_key: { cashierId, key } },
                data: {
                    orderId: receipt.id,
                    receiptJson: receipt as unknown as Prisma.InputJsonValue
                }
            })

            return { receipt, replayed: false }
        },
        { isolationLevel: 'ReadCommitted' }
    )
}
