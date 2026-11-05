import { Router } from 'express'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../errors/api-error.js'
import {
    createProductSchema,
    updateProductSchema,
    listProductsQuerySchema,
    productIdSchema
} from '../schemas/product.schema.js'

export function createProductRouter(db: PrismaClient) {
    const router = Router()

    router.get('/', async (req, res) => {
        const { search, page, limit, sortBy, order } =
            listProductsQuerySchema.parse(req.query)

        const skip = (page - 1) * limit

        if (!Number.isSafeInteger(skip)) {
            throw new ApiError(
                400,
                'INVALID_PAGE',
                'Requested page is too large'
            )
        }

        const where: Prisma.ProductWhereInput = {
            isActive: true,
            ...(search
                ? {
                      OR: [
                          { name: { contains: search, mode: 'insensitive' } },
                          { sku: { contains: search, mode: 'insensitive' } }
                      ]
                  }
                : {})
        }

        let primaryOrder: Prisma.ProductOrderByWithRelationInput

        if (sortBy === 'name') {
            primaryOrder = { name: order }
        } else if (sortBy === 'price') {
            primaryOrder = { price: order }
        } else {
            primaryOrder = { stockQuantity: order }
        }

        const [products, total] = await db.$transaction(
            [
                db.product.findMany({
                    where,
                    orderBy: [primaryOrder, { id: 'asc' }],
                    skip,
                    take: limit
                }),
                db.product.count({ where })
            ],
            { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
        )

        res.status(200).json({
            data: products,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        })
    })

    router.get('/:id', async (req, res) => {
        const id = productIdSchema.parse(req.params.id)

        const product = await db.product.findFirst({
            where: { id, isActive: true }
        })

        if (!product) {
            throw new ApiError(
                404,
                'PRODUCT_NOT_FOUND',
                'Product not found'
            )
        }

        res.status(200).json({ data: product })
    })

    router.post('/', async (req, res) => {
        const input = createProductSchema.parse(req.body)

        const product = await db.product.create({
            data: input
        })

        res
            .location(`/api/v1/products/${product.id}`)
            .status(201)
            .json({ data: product })
    })

    router.patch('/:id', async (req, res) => {
        const id = productIdSchema.parse(req.params.id)
        const input = updateProductSchema.parse(req.body)

        const product = await db.product.update({
            where: { id, isActive: true },
            data: input
        })

        res.status(200).json({ data: product })
    })

    router.delete('/:id', async (req, res) => {
        const id = productIdSchema.parse(req.params.id)

        await db.product.update({
            where: { id, isActive: true },
            data: { isActive: false }
        })

        res.status(204).send()
    })

    return router
}

export default createProductRouter
