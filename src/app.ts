import express from 'express'
import productRouter from './routes/product.routes.js'
import { errorHandler } from './middleware/errorhandler.js'

const app = express()

app.use(express.json())

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'retailflow-api'
    })
})

app.use('/api/v1/products', productRouter)



app.use((req, res) => {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: 'Route not found'
        }
    })
})

app.use(errorHandler)
export default app