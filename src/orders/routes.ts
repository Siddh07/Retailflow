import { Router } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'
import { currentAuth } from '../auth/middleware.js'
import { ApiError } from '../errors/api-error.js'
import { checkoutSchema } from './schemas.js'
import { checkout } from './checkout.js'
import { refundSchema } from './refund-schema.js'
import { refundOrder } from './refund.js'

export function createOrdersRouter(db: PrismaClient) {
    const router = Router()

    router.post('/checkout', async (req, res) => {
        const rawKey = req.header('idempotency-key')
        if (
            !rawKey ||
            typeof rawKey !== 'string' ||
            rawKey.trim().length === 0 ||
            rawKey.length > 100
        ) {
            throw new ApiError(
                400,
                'MISSING_IDEMPOTENCY_KEY',
                'A non-empty Idempotency-Key header (max 100 characters) is required'
            )
        }
        const key = rawKey.trim()

        const input = checkoutSchema.parse(req.body)
        const cashierId = currentAuth(res).user.id
        const { receipt, replayed } = await checkout(db, cashierId, key, input)

        if (replayed) {
            res.setHeader('Idempotency-Replayed', 'true')
            res.status(200).json({ data: receipt })
            return
        }

        res
            .location(`/api/v1/orders/${receipt.id}`)
            .status(201)
            .json({ data: receipt })
    })

    router.post('/:id/refund', async (req, res) => {
        const { user } = currentAuth(res)
        if (user.role !== 'ADMIN') {
            throw new ApiError(403, 'FORBIDDEN', 'Only administrators can refund orders')
        }

        const id = z.uuid().parse(req.params.id)
        const input = refundSchema.parse(req.body)
        const refund = await refundOrder(db, id, user.id, input)

        res.status(201).json({ data: refund })
    })

    router.get('/:id/audit', async (req, res) => {
        const { user } = currentAuth(res)
        if (user.role !== 'ADMIN') {
            throw new ApiError(403, 'FORBIDDEN', 'Only administrators can view order audit trail')
        }

        const id = z.uuid().parse(req.params.id)
        const order = await db.order.findUnique({
            where: { id },
            select: { id: true }
        })
        if (!order) {
            throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found')
        }

        const events = await db.auditEvent.findMany({
            where: { orderId: id },
            orderBy: { createdAt: 'asc' },
            include: {
                actor: {
                    select: {
                        id: true,
                        email: true,
                        role: true
                    }
                }
            }
        })

        res.json({ data: events })
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
