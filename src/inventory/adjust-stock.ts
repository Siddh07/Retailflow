import type { PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../errors/api-error.js'
import type { Adjustment } from './schemas.js'

const MAX_STOCK = 1_000_000

export async function adjustStock(
    db: PrismaClient,
    productId: string,
    actorId: string,
    input: Adjustment
) {
    return db.$transaction(async (tx) => {
        const stockCondition =
            input.delta < 0
                ? { gte: -input.delta }
                : { lte: MAX_STOCK - input.delta }

        const changed = await tx.product.updateMany({
            where: {
                id: productId,
                isActive: true,
                stockQuantity: stockCondition
            },
            data: {
                stockQuantity: { increment: input.delta }
            }
        })

        if (changed.count === 0) {
            const activeProduct = await tx.product.findFirst({
                where: { id: productId, isActive: true },
                select: { id: true }
            })

            if (!activeProduct) {
                throw new ApiError(
                    404,
                    'PRODUCT_NOT_FOUND',
                    'Product not found'
                )
            }

            throw new ApiError(
                409,
                'STOCK_LIMIT',
                'Adjustment would put stock outside its allowed range'
            )
        }










        const movement = await tx.inventoryMovement.create({
            data: {
                productId,
                actorId,
                kind: input.kind,
                delta: input.delta,
                reason: input.reason
            }
        })

        const product = await tx.product.findUniqueOrThrow({
            where: { id: productId },
            select: {
                id: true,
                sku: true,
                stockQuantity: true
            }
        })

        return { product, movement }
    })
}

