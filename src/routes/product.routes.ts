import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { ApiError } from '../errors/api-error.js'
import {
    createProductSchema,
    listProductsQuerySchema,
    updateProductSchema,
    type Product
} from '../schemas/product.schema.js'

export function createProductRouter() {
    const router = Router()

    const products: Product[] = [
        {
            id: '1',
            name: 'Keyboard',
            sku: 'KEY-001',
            price: 2000,
            stockQuantity: 10
        },
        {
            id: '2',
            name: 'Mouse',
            sku: 'MOU-001',
            price: 1000,
            stockQuantity: 5
        }
    ]


    router.get('/', (req, res) => {
        const { search, page, limit, sortBy, order } =
            listProductsQuerySchema.parse(req.query)

        const query = search.toLowerCase()

        const filteredProducts = products.filter((product) => {
            return (
                product.name.toLowerCase().includes(query) ||
                product.sku.toLowerCase().includes(query)
            )
        })

        const direction = order === 'asc' ? 1 : -1

        const sortedProducts = [...filteredProducts].sort((a, b) => {
            let comparison: number

            if (sortBy === 'name') {
                comparison = a.name.localeCompare(b.name)
            } else {
                comparison = a[sortBy] - b[sortBy]
            }

            if (comparison === 0) {
                comparison = a.id.localeCompare(b.id)
            }

            return comparison * direction
        })

        const total = sortedProducts.length
        const totalPages = Math.ceil(total / limit)
        const start = (page - 1) * limit

        const paginatedProducts = sortedProducts.slice(
            start,
            start + limit
        )

        res.status(200).json({
            data: paginatedProducts,
            pagination: {
                page,
                limit,
                total,
                totalPages
            }
        })
    })



    router.get('/:id', (req, res) => {
        const product = products.find((item) => {
            return item.id === req.params.id
        })

        if (!product) {
            throw new ApiError(
                404,
                'PRODUCT_NOT_FOUND',
                'Product not found'
            )
        }

        res.status(200).json({
            data: product
        })
    })

    // POST /api/v1/products
    router.post('/', (req, res) => {
        const input = createProductSchema.parse(req.body)

        const duplicateExist = products.some((product) => {
            return product.sku === input.sku
        })

        if (duplicateExist) {
            throw new ApiError(
                400,
                'PRODUCT_ALREADY_EXIST',
                'Product already exist'
            )
        }

        const product: Product = {
            id: randomUUID(),
            ...input
        }

        products.push(product)

        res
            .location(`/api/v1/products/${product.id}`)
            .status(201)
            .json({
                data: product
            })


    })



    router.patch('/:id', (req, res) => {
        const product = products.find((item) => {
            return item.id === req.params.id
        })

        if (!product) {
            throw new ApiError(
                404,
                'PRODUCT_NOT_FOUND',
                'Product not found'
            )
        }

        const input = updateProductSchema.parse(req.body)

        if (input.sku !== undefined) {
            const duplicateExists = products.some((item) => {
                return (
                    item.sku === input.sku &&
                    item.id !== product.id
                )
            })

            if (duplicateExists) {
                throw new ApiError(
                    409,
                    'SKU_ALREADY_EXISTS',
                    'A product with this SKU already exists'
                )
            }
        }

        Object.assign(product, input)

        res.status(200).json({
            data: product
        })
    })


    router.delete('/:id', (req, res) => {
        const index = products.findIndex((item) => {
            return item.id === req.params.id
        })
        if (index === -1) {
            throw new ApiError(
                404,
                'PRODUCT_NOT_FOUND',
                'Product not found'
            )
        }

        products.splice(index, 1)

        res.status(204).send()

    })





    return router
}

export default createProductRouter