import { Router } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { currentAuth, requireAdmin } from '../auth/middleware.js'
import { ApiError } from '../errors/api-error.js'
import { pageQuery } from '../schemas/pagination.js'
import { productIdSchema } from '../schemas/product.schema.js'
import { adjustmentSchema } from './schemas.js'
import { adjustStock } from './adjust-stock.js'

export function createInventoryRouter(db: PrismaClient) {
    const router = Router()

    router.post(
        '/products/:id/adjustments',
        requireAdmin,
        async (req, res) => {
            const productId = productIdSchema.parse(req.params.id)
            const input = adjustmentSchema.parse(req.body)
            const actorId = currentAuth(res).user.id

            const result = await adjustStock(db, productId, actorId, input)
            res.status(201).json({ data: result })
        }
    )

    router.get(
        '/products/:id/movements',
        requireAdmin,
        async (req, res) => {
            const productId = productIdSchema.parse(req.params.id)
            const { page, limit } = pageQuery.parse(req.query)

            const product = await db.product.findUnique({
                where: { id: productId },
                select: { id: true }
            })

            if (!product) {
                throw new ApiError(
                    404,
                    'PRODUCT_NOT_FOUND',
                    'Product not found'
                )
            }

            const where = { productId }

            const [data, total] = await db.$transaction(
                [
                    db.inventoryMovement.findMany({
                        where,
                        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                        skip: (page - 1) * limit,
                        take: limit
                    }),
                    db.inventoryMovement.count({ where })
                ],
                { isolationLevel: 'RepeatableRead' }
            )

            res.json({
                data,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            })
        }
    )

    router.get('/low-stock', requireAdmin, async (req, res) => {
        const { page, limit } = pageQuery.parse(req.query)

        const where = {
            isActive: true,
            stockQuantity: { lte: db.product.fields.lowStockThreshold }
        }

        const [data, total] = await db.$transaction(
            [
                db.product.findMany({
                    where,
                    select: {
                        id: true,
                        sku: true,
                        name: true,
                        stockQuantity: true,
                        lowStockThreshold: true
                    },
                    orderBy: [{ stockQuantity: 'asc' }, { id: 'asc' }],
                    skip: (page - 1) * limit,
                    take: limit
                }),
                db.product.count({ where })
            ],
            { isolationLevel: 'RepeatableRead' }
        )

        res.json({
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        })
    })

    return router
}

