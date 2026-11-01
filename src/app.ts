import express from 'express'
import { createProductRouter } from './routes/product.routes.js'
import { errorHandler } from './middleware/errorhandler.js'

export function createApp() {
    const app = express()

    app.use(express.json({ limit: '100kb' }))

    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'retailflow-api'
        })
    })

    app.use('/api/v1/products', createProductRouter())

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

export default createApp()