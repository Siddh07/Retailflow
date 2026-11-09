import { Router } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createEmployeeSchema } from './schemas.js'
import { hashPassword } from './password.js'

export function createUsersRouter(db: PrismaClient) {
    const router = Router()

    router.post('/', async (req, res) => {
        const input = createEmployeeSchema.parse(req.body)

        const passwordHash = await hashPassword(input.password)

        const user = await db.user.create({
            data: {
                email: input.email,
                passwordHash,
                role: input.role
            },

            select: {
                id: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true
            }
        })

        res.status(201).json({
            data: user
        })
    })

    return router
}