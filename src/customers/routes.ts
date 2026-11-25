import { Router } from 'express'
import { z } from 'zod'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { requireAdmin } from '../auth/middleware.js'
import { ApiError } from '../errors/api-error.js'
import { customerInput, customerPatch, customerQuery } from './schemas.js'

const customerId = z.uuid()

export function createCustomerRouter(db: PrismaClient) {
    const router = Router()

    router.post('/', async (req, res) => {
        const input = customerInput.parse(req.body)
        const customer = await db.customer.create({ data: input })

        res
            .location(`/api/v1/customers/${customer.id}`)
            .status(201)
            .json({ data: customer })
    })

    router.get('/', async (req, res) => {
        const { search, status, page, limit } = customerQuery.parse(req.query)

        // Treat %, _, and backslash as literal search characters.
        const term = search.replace(/[\\%_]/g, '\\$&')

        const where: Prisma.CustomerWhereInput = {
            ...(status ? { status } : {}),
            ...(term
                ? {
                    OR: [
                        { name: { contains: term, mode: 'insensitive' } },
                        { email: { contains: term, mode: 'insensitive' } },
                        { company: { contains: term, mode: 'insensitive' } }
                    ]
                }
                : {})
        }

        const [data, total] = await db.$transaction(
            [
                db.customer.findMany({
                    where,
                    orderBy: [{ name: 'asc' }, { id: 'asc' }],
                    skip: (page - 1) * limit,
                    take: limit
                }),
                db.customer.count({ where })
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

    router.get('/:id', async (req, res) => {
        const id = customerId.parse(req.params.id)
        const customer = await db.customer.findUnique({ where: { id } })

        if (!customer) {
            throw new ApiError(
                404,
                'CUSTOMER_NOT_FOUND',
                'Customer not found'
            )
        }

        res.json({ data: customer })
    })

    router.patch('/:id', requireAdmin, async (req, res) => {
        const id = customerId.parse(req.params.id)
        const input = customerPatch.parse(req.body)
        const customer = await db.customer.update({
            where: { id },
            data: input
        })

        res.json({ data: customer })
    })

    router.get('/:id/stats', requireAdmin, async (req, res) => {
        const id = customerId.parse(req.params.id)

        const [customer, sales] = await db.$transaction(
            [
                db.customer.findUnique({
                    where: { id },
                    select: { id: true }
                }),
                db.order.aggregate({
                    where: { customerId: id, status: 'COMPLETED' },
                    _count: { _all: true },
                    _sum: { total: true }
                })
            ],
            { isolationLevel: 'RepeatableRead' }
        )

        if (!customer) {
            throw new ApiError(
                404,
                'CUSTOMER_NOT_FOUND',
                'Customer not found'
            )
        }

        res.json({
            data: {
                customerId: id,
                completedOrderCount: sales._count._all,
                lifetimeSpendNpr: sales._sum.total ?? 0
            }
        })
    })

    return router
}

