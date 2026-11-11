import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import type { PrismaClient } from './generated/prisma/client.js'
import type { AuthConfig } from './auth/config.js'
import { browserSecurity } from './auth/browser-security.js'
import { createAuthRouter } from './auth/routes.js'
import { createUsersRouter } from './auth/users.routes.js'
import {
    createRequireAuth,
    requireAdmin
} from './auth/middleware.js'
import { createProductRouter } from './routes/product.routes.js'
import { createCustomerRouter } from './customers/routes.js'
import { createInventoryRouter } from './inventory/routes.js'
import { errorHandler } from './middleware/error-handler.js'

export function createApp(
    db: PrismaClient,
    authConfig: AuthConfig
) {
    const app = express()
    const requireAuth = createRequireAuth(db, authConfig)

    app.use(
        cors({
            origin: authConfig.appOrigin,
            credentials: true,
            methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: [
                'Content-Type',
                'Authorization',
                'X-CSRF-Protection'
            ]
        })
    )

    app.use('/api', browserSecurity(authConfig))
    app.use(express.json({ limit: '100kb' }))
    app.use(cookieParser())

    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'retailflow-api'
        })
    })

    app.use(
        '/api/v1/auth',
        createAuthRouter(db, authConfig)
    )

    app.use(
        '/api/v1/users',
        requireAuth,
        requireAdmin,
        createUsersRouter(db)
    )

    app.use(
        '/api/v1/products',
        requireAuth,
        createProductRouter(db)
    )

    app.use(
        '/api/v1/customers',
        requireAuth,
        createCustomerRouter(db)
    )

    app.use(
        '/api/v1/inventory',
        requireAuth,
        createInventoryRouter(db)
    )

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
