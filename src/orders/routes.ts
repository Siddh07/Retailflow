import { Router } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'
import { currentAuth } from '../auth/middleware.js'
import { ApiError } from '../errors/api-error.js'
import { checkoutSchema } from './schemas.js'
import { checkout } from './checkout.js'

export function createOrdersRouter(db: PrismaClient) {
    const router = Router()

    router.post('/checkout', async (req, res) => {
        const input = checkoutSchema.parse(req.body)
        const cashierId = currentAuth(res).user.id
        const receipt = await checkout(db, cashierId, input)

        res
            .location(`/api/v1/orders/${receipt.id}`)
            .status(201)
            .json({ data: receipt })
    })

    router.get('/:id', async (req, res) => {
        const id = z.uuid().parse(req.params.id)
        const { user } = currentAuth(res)

        const receipt = await db.order.findFirst({
            where: {
                id,
                ...(user.role === 'CASHIER' ? { cashierId: user.id } : {})
            },
            include: {
                items: {
                    orderBy: { productId: 'asc' }
                }
            }
        })

        if (!receipt) {
            throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found')
        }

        res.json({ data: receipt })
    })

    return router
}
