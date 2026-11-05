import { config } from 'dotenv'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'

config({ path: '.env.test', override: true })

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
    throw new Error('Test DATABASE_URL is missing')
}

const url = new URL(connectionString)

if (
    url.hostname !== 'localhost' ||
    url.pathname !== '/retailflow_test'
) {
    throw new Error('Refusing to reset a non-test database')
}

const db = createDatabaseClient(connectionString)
const app = createApp(db)

const keyboardId = '11111111-1111-4111-8111-111111111111'
const mouseId = '22222222-2222-4222-8222-222222222222'
const missingId = '33333333-3333-4333-8333-333333333333'

const validProduct = {
    name: 'Monitor',
    sku: 'MON-001',
    price: 25000,
    stockQuantity: 4
}

beforeAll(async () => {
    await db.$connect()

    const rows = await db.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name
    `

    if (rows[0]?.name !== 'retailflow_test') {
        throw new Error('Connected database is not retailflow_test')
    }
})

beforeEach(async () => {
    // Delete children before parents because of foreign keys.
    await db.$transaction([
        db.orderItem.deleteMany(),
        db.order.deleteMany(),
        db.customer.deleteMany(),
        db.user.deleteMany(),
        db.product.deleteMany()
    ])

    await db.product.createMany({
        data: [
            {
                id: keyboardId,
                name: 'Keyboard',
                sku: 'KEY-001',
                price: 2000,
                stockQuantity: 10
            },
            {
                id: mouseId,
                name: 'Mouse',
                sku: 'MOU-001',
                price: 1000,
                stockQuantity: 5
            }
        ]
    })
})

afterAll(async () => {
    await db.$disconnect()
})

describe('Database-backed products', () => {
    it('stores a created product in PostgreSQL', async () => {
        const response = await request(app)
            .post('/api/v1/products')
            .send(validProduct)

        expect(response.status).toBe(201)

        const stored = await db.product.findUnique({
            where: { id: response.body.data.id }
        })

        expect(stored).toMatchObject(validProduct)
    })

    it.each([
        { price: -1 },
        { price: '2000' },
        { stockQuantity: 1.5 },
        { name: '   ' }
    ])('rejects invalid creation: %j', async (changes) => {
        await request(app)
            .post('/api/v1/products')
            .send({ ...validProduct, ...changes })
            .expect(400)

        expect(await db.product.count()).toBe(2)
    })

    it('rejects a duplicate SKU after normalization', async () => {
        const response = await request(app)
            .post('/api/v1/products')
            .send({ ...validProduct, sku: ' key-001 ' })

        expect(response.status).toBe(409)
        expect(await db.product.count()).toBe(2)
    })

    it('allows only one concurrent creation of the same SKU', async () => {
        const responses = await Promise.all([
            request(app).post('/api/v1/products').send(validProduct),
            request(app).post('/api/v1/products').send(validProduct)
        ])

        expect(
            responses.map((response) => response.status).sort()
        ).toEqual([201, 409])

        expect(
            await db.product.count({ where: { sku: 'MON-001' } })
        ).toBe(1)
    })

    it('updates a product and preserves unrelated fields', async () => {
        await request(app)
            .patch(`/api/v1/products/${keyboardId}`)
            .send({ price: 2500 })
            .expect(200)

        const product = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })

        expect(product.price).toBe(2500)
        expect(product.sku).toBe('KEY-001')
        expect(product.stockQuantity).toBe(10)
    })

    it('rejects a conflicting update without partial changes', async () => {
        await request(app)
            .patch(`/api/v1/products/${keyboardId}`)
            .send({ sku: 'MOU-001', price: 50 })
            .expect(409)

        const product = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })

        expect(product.sku).toBe('KEY-001')
        expect(product.price).toBe(2000)
    })

    it('archives rather than physically deleting', async () => {
        await request(app)
            .delete(`/api/v1/products/${keyboardId}`)
            .expect(204)

        await request(app)
            .get(`/api/v1/products/${keyboardId}`)
            .expect(404)

        const stored = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })

        expect(stored.isActive).toBe(false)

        const list = await request(app).get('/api/v1/products')

        expect(list.body.pagination.total).toBe(1)
    })

    it('distinguishes malformed IDs from missing records', async () => {
        await request(app)
            .get('/api/v1/products/not-a-uuid')
            .expect(400)

        await request(app)
            .get(`/api/v1/products/${missingId}`)
            .expect(404)
    })

    it('filters, sorts, and paginates in the database', async () => {
        await db.product.create({ data: validProduct })

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
        expect(response.body.pagination.total).toBe(2)
    })

    it('enforces stock constraints even outside the API', async () => {
        await expect(
            db.product.update({
                where: { id: keyboardId },
                data: { stockQuantity: -1 }
            })
        ).rejects.toThrow()

        const product = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })

        expect(product.stockQuantity).toBe(10)
    })

    it('enforces foreign keys', async () => {
        await expect(
            db.order.create({
                data: {
                    orderNumber: 'INVALID-CASHIER',
                    cashierId: missingId,
                    subtotal: 0,
                    total: 0
                }
            })
        ).rejects.toMatchObject({ code: 'P2003' })
    })
})
