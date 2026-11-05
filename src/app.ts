import express from 'express'
import type { PrismaClient } from './generated/prisma/client.js'
import { createProductRouter } from './routes/product.routes.js'
import { errorHandler } from './middleware/error-handler.js'

export function createApp(db: PrismaClient) {
    const app = express()

    app.use(express.json({ limit: '100kb' }))

    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'retailflow-api'
        })
    })

    app.use('/api/v1/products', createProductRouter(db))

    app.use((req, res) => {
        res.status(404).json({
            error: {
                code: 'NOT_FOUND',
                message: 'Route not found'
            }
        })
    })

    app.use(errorHandler)

    return app
}
