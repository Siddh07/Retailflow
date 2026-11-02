import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'

let app: ReturnType<typeof createApp>

beforeEach(() => {
    app = createApp()
})

const validProduct = {
    name: 'Monitor',
    sku: 'MON-001',
    price: 25000,
    stockQuantity: 4
}

describe('Products API', () => {
    it('creates a product and retrieves it by ID', async () => {
        const created = await request(app)
            .post('/api/v1/products')
            .send({
                ...validProduct,
                name: ' Monitor ',
                sku: ' mon-001 '
            })

        expect(created.status).toBe(201)
        expect(created.body.data).toMatchObject(validProduct)
        expect(created.body.data.id).toEqual(expect.any(String))

        const fetched = await request(app)
            .get(`/api/v1/products/${created.body.data.id}`)

        expect(fetched.status).toBe(200)
        expect(fetched.body.data).toEqual(created.body.data)
    })

    it.each([
        { price: -1 },
        { price: '2000' },
        { stockQuantity: 1.5 },
        { name: '   ' },
        { id: 'client-chosen' }
    ])('rejects invalid creation input: %j', async (changes) => {
        const response = await request(app)
            .post('/api/v1/products')
            .send({ ...validProduct, ...changes })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('VALIDATION_ERROR')

        const list = await request(app).get('/api/v1/products')

        expect(list.body.pagination.total).toBe(2)
    })

    it('rejects duplicate SKUs after normalization', async () => {
        const response = await request(app)
            .post('/api/v1/products')
            .send({
                ...validProduct,
                sku: ' key-001 '
            })

        expect(response.status).toBe(409)
    })

    it('updates one field and preserves the other fields', async () => {
        const response = await request(app)
            .patch('/api/v1/products/1')
            .send({ price: 2500 })

        expect(response.status).toBe(200)
        expect(response.body.data).toEqual({
            id: '1',
            name: 'Keyboard',
            sku: 'KEY-001',
            price: 2500,
            stockQuantity: 10
        })
    })

    it('allows a product to keep its own SKU', async () => {
        const response = await request(app)
            .patch('/api/v1/products/1')
            .send({ sku: 'key-001' })

        expect(response.status).toBe(200)
    })

    it('rejects a conflicting update without changing the product', async () => {
        const response = await request(app)
            .patch('/api/v1/products/1')
            .send({
                sku: 'MOU-001',
                price: 50
            })

        expect(response.status).toBe(409)

        const fetched = await request(app)
            .get('/api/v1/products/1')

        expect(fetched.body.data.sku).toBe('KEY-001')
        expect(fetched.body.data.price).toBe(2000)
    })

    it.each([
        {},
        { price: -1 },
        { id: 'replacement-id' }
    ])('rejects invalid updates: %j', async (changes) => {
        const response = await request(app)
            .patch('/api/v1/products/1')
            .send(changes)

        expect(response.status).toBe(400)

        const fetched = await request(app)
            .get('/api/v1/products/1')

        expect(fetched.body.data.id).toBe('1')
        expect(fetched.body.data.price).toBe(2000)
    })

    it('returns 404 for operations on a missing product', async () => {
        await request(app)
            .get('/api/v1/products/missing')
            .expect(404)

        await request(app)
            .patch('/api/v1/products/missing')
            .send({ price: 100 })
            .expect(404)

        await request(app)
            .delete('/api/v1/products/missing')
            .expect(404)

        const list = await request(app).get('/api/v1/products')

        expect(list.body.pagination.total).toBe(2)
    })

    it('deletes only the requested product', async () => {
        const deleted = await request(app)
            .delete('/api/v1/products/1')

        expect(deleted.status).toBe(204)
        expect(deleted.text).toBe('')

        await request(app)
            .get('/api/v1/products/1')
            .expect(404)

        await request(app)
            .get('/api/v1/products/2')
            .expect(200)
    })

    it('filters before sorting and pagination', async () => {
        await request(app)
            .post('/api/v1/products')
            .send(validProduct)
            .expect(201)

        const response = await request(app)
            .get('/api/v1/products')
            .query({
                search: 'MO',
                sortBy: 'price',
                order: 'desc',
                page: 2,
                limit: 1
            })

        expect(response.status).toBe(200)
        expect(response.body.data).toHaveLength(1)
        expect(response.body.data[0].name).toBe('Mouse')
        expect(response.body.pagination).toEqual({
            page: 2,
            limit: 1,
            total: 2,
            totalPages: 2
        })
    })

    it.each([
        'page=0',
        'page=abc',
        'limit=101',
        'sortBy=password',
        'order=sideways',
        'page=1&page=2'
    ])('rejects invalid query: %s', async (query) => {
        await request(app)
            .get(`/api/v1/products?${query}`)
            .expect(400)
    })

    it('returns an empty list when nothing matches', async () => {
        const response = await request(app)
            .get('/api/v1/products?search=not-present')

        expect(response.status).toBe(200)
        expect(response.body.data).toEqual([])
        expect(response.body.pagination.total).toBe(0)
        expect(response.body.pagination.totalPages).toBe(0)
    })

    it('rejects malformed JSON', async () => {
        const response = await request(app)
            .post('/api/v1/products')
            .set('Content-Type', 'application/json')
            .send('{"name":')

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('INVALID_JSON')
    })
})