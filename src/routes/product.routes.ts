import { Router } from 'express'

const productRouter = Router()

const products = [
    {
        id: '1',
        name: 'Keyboard',
        price: 2000,
        stockQuantity: 10
    },
    {
        id: '2',
        name: 'Mouse',
        price: 1000,
        stockQuantity: 5
    }
]

productRouter.get('/', (req, res) => {
    res.status(200).json({
        data: products
    })
})

export default productRouter