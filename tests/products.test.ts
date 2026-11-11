import { randomBytes } from 'node:crypto'
import { config } from 'dotenv'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { loadAuthConfig, type AuthConfig } from '../src/auth/config.js'
import { hashPassword } from '../src/auth/password.js'
import { adjustStock } from '../src/inventory/adjust-stock.js'

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

let app: ReturnType<typeof createApp>
let authConfig: AuthConfig
let adminPasswordHash: string
let adminToken: string
let adminId: string
let cashierToken: string
let cashierId: string
const adminPassword = 'A long test administrator passphrase'

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

    authConfig = await loadAuthConfig({
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://localhost:5173',
        JWT_SECRET_BASE64: randomBytes(32).toString('base64')
    })
    adminPasswordHash = await hashPassword(adminPassword)
})

beforeEach(async () => {
    // Delete children before parents because of foreign keys.
    await db.$transaction([
        db.inventoryMovement.deleteMany(),
        db.session.deleteMany(),
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

    app = createApp(db, authConfig)

    const adminUser = await db.user.create({
        data: {
            email: 'admin@example.com',
            passwordHash: adminPasswordHash,
            role: 'ADMIN'
        }
    })
    adminId = adminUser.id

    const cashierUser = await db.user.create({
        data: {
            email: 'cashier@example.com',
            passwordHash: adminPasswordHash,
            role: 'CASHIER'
        }
    })
    cashierId = cashierUser.id

    const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({
            email: 'admin@example.com',
            password: adminPassword
        })
        .expect(200)

    adminToken = adminLogin.body.data.accessToken

    const cashierLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({
            email: 'cashier@example.com',
            password: adminPassword
        })
        .expect(200)

    cashierToken = cashierLogin.body.data.accessToken
})

afterAll(async () => {
    await db.$disconnect()
})

describe('Database-backed products', () => {
    it('stores a created product in PostgreSQL', async () => {
        const response = await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
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
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ ...validProduct, ...changes })
            .expect(400)

        expect(await db.product.count()).toBe(2)
    })

    it('rejects a duplicate SKU after normalization', async () => {
        const response = await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ ...validProduct, sku: ' key-001 ' })

        expect(response.status).toBe(409)
        expect(await db.product.count()).toBe(2)
    })

    it('allows only one concurrent creation of the same SKU', async () => {
        const responses = await Promise.all([
            request(app)
                .post('/api/v1/products')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send(validProduct),
            request(app)
                .post('/api/v1/products')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send(validProduct)
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
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
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
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
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
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .expect(204)

        await request(app)
            .get(`/api/v1/products/${keyboardId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(404)

        const stored = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })

        expect(stored.isActive).toBe(false)

        const list = await request(app)
            .get('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)

        expect(list.body.pagination.total).toBe(1)
    })

    it('distinguishes malformed IDs from missing records', async () => {
        await request(app)
            .get('/api/v1/products/not-a-uuid')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(400)

        await request(app)
            .get(`/api/v1/products/${missingId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(404)
    })

    it('filters, sorts, and paginates in the database', async () => {
        await db.product.create({ data: validProduct })

        const response = await request(app)
            .get('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
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

describe('Phase 5 — Inventory movements and customers', () => {
    it('tracks opening, receipt, correction, and rejects over-removal', async () => {
        const created = await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'Practice Keyboard',
                sku: 'P5-KEY-001',
                price: 2000,
                stockQuantity: 10,
                lowStockThreshold: 9
            })
            .expect(201)

        const id = created.body.data.id

        await request(app)
            .post(`/api/v1/inventory/products/${id}/adjustments`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                kind: 'RECEIPT',
                delta: 4,
                reason: 'Supplier delivery received'
            })
            .expect(201)

        const afterCorrection = await request(app)
            .post(`/api/v1/inventory/products/${id}/adjustments`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                kind: 'CORRECTION',
                delta: -5,
                reason: 'Five units damaged during handling'
            })
            .expect(201)

        expect(afterCorrection.body.data.product.stockQuantity).toBe(9)

        await request(app)
            .post(`/api/v1/inventory/products/${id}/adjustments`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                kind: 'CORRECTION',
                delta: -10,
                reason: 'Should be rejected'
            })
            .expect(409)

        const history = await request(app)
            .get(`/api/v1/inventory/products/${id}/movements`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)

        expect(history.body.data).toHaveLength(3)
        expect(
            history.body.data.reduce(
                (sum: number, row: { delta: number }) => sum + row.delta,
                0
            )
        ).toBe(9)
    })

    it('allows only one of two removals when stock is insufficient for both', async () => {
        const created = await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'USB Hub',
                sku: 'P5-HUB',
                price: 500,
                stockQuantity: 5
            })
            .expect(201)

        const id = created.body.data.id
        const url = `/api/v1/inventory/products/${id}/adjustments`

        const removeFour = () =>
            request(app)
                .post(url)
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send({
                    kind: 'CORRECTION',
                    delta: -4,
                    reason: 'Damaged units'
                })

        const responses = await Promise.all([removeFour(), removeFour()])
        expect(responses.map((r) => r.status).sort()).toEqual([201, 409])

        const product = await db.product.findUniqueOrThrow({ where: { id } })
        const history = await db.inventoryMovement.findMany({
            where: { productId: id }
        })

        expect(product.stockQuantity).toBe(1)
        expect(history).toHaveLength(2)
        expect(history.reduce((sum, row) => sum + row.delta, 0)).toBe(1)
    })

    it('rolls back the balance when PostgreSQL rejects the movement', async () => {
        const before = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })
        const historyBefore = await db.inventoryMovement.count({
            where: { productId: keyboardId }
        })
        const missingEmployee = '99999999-9999-4999-8999-999999999999'

        await expect(
            adjustStock(db, keyboardId, missingEmployee, {
                kind: 'RECEIPT',
                delta: 3,
                reason: 'Rollback integration test'
            })
        ).rejects.toMatchObject({ code: 'P2003' })

        const after = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })
        expect(after.stockQuantity).toBe(before.stockQuantity)
        expect(
            await db.inventoryMovement.count({
                where: { productId: keyboardId }
            })
        ).toBe(historyBefore)
    })

    it('rejects cashier adjustment submissions with 403 and leaves stock unchanged', async () => {
        const before = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })
        const historyBefore = await db.inventoryMovement.count({
            where: { productId: keyboardId }
        })

        await request(app)
            .post(`/api/v1/inventory/products/${keyboardId}/adjustments`)
            .set('Authorization', `Bearer ${cashierToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                kind: 'RECEIPT',
                delta: 5,
                reason: 'Unauthorized adjustment'
            })
            .expect(403)

        const after = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })
        expect(after.stockQuantity).toBe(before.stockQuantity)
        expect(
            await db.inventoryMovement.count({
                where: { productId: keyboardId }
            })
        ).toBe(historyBefore)
    })

    it.each([
        { kind: 'CORRECTION', delta: 0, reason: 'Zero change' },
        { kind: 'RECEIPT', delta: -1, reason: 'Negative receipt' },
        {
            kind: 'RECEIPT',
            delta: 2,
            reason: 'Spoofed actor',
            actorId: '99999999-9999-4999-8999-999999999999'
        }
    ])('rejects invalid adjustment payload: %j', async (payload) => {
        await request(app)
            .post(`/api/v1/inventory/products/${keyboardId}/adjustments`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send(payload)
            .expect(400)

        expect(
            await db.inventoryMovement.count({
                where: { productId: keyboardId }
            })
        ).toBe(0)
    })

    it('rejects direct stockQuantity edits via PATCH /products/:id', async () => {
        await request(app)
            .patch(`/api/v1/products/${keyboardId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ stockQuantity: 99 })
            .expect(400)

        const product = await db.product.findUniqueOrThrow({
            where: { id: keyboardId }
        })
        expect(product.stockQuantity).toBe(10)
    })

    it('rejects adjustments on archived products while keeping history readable', async () => {
        const created = await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'Archived Gadget',
                sku: 'P5-ARC-001',
                price: 1500,
                stockQuantity: 4
            })
            .expect(201)

        const id = created.body.data.id

        await request(app)
            .delete(`/api/v1/products/${id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .expect(204)

        await request(app)
            .post(`/api/v1/inventory/products/${id}/adjustments`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                kind: 'RECEIPT',
                delta: 2,
                reason: 'After archive'
            })
            .expect(404)

        const history = await request(app)
            .get(`/api/v1/inventory/products/${id}/movements`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)

        expect(history.body.data).toHaveLength(1)
        expect(history.body.data[0].kind).toBe('OPENING')
    })

    it('includes products whose stock equals their lowStockThreshold in low-stock results', async () => {
        const created = await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'Cable',
                sku: 'P5-CBL-001',
                price: 300,
                stockQuantity: 5,
                lowStockThreshold: 5
            })
            .expect(201)

        // Seeded Mouse has stock 5 and threshold 5 as well, Keyboard has stock 10 > 5.
        const response = await request(app)
            .get('/api/v1/inventory/low-stock')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)

        const skus = response.body.data.map((p: { sku: string }) => p.sku)
        expect(skus).toContain(created.body.data.sku)
        expect(skus).not.toContain('KEY-001')
    })

    it('supports customer creation, search, PATCH omitted vs null phone, and derived stats', async () => {
        const sita = await request(app)
            .post('/api/v1/customers')
            .set('Authorization', `Bearer ${cashierToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'Sita Shrestha',
                email: 'sita@example.com',
                phone: '9800000001',
                company: 'Demo Stationery',
                status: 'ACTIVE'
            })
            .expect(201)

        const other = await request(app)
            .post('/api/v1/customers')
            .set('Authorization', `Bearer ${cashierToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'Ram Bahadur',
                email: 'ram@example.com'
            })
            .expect(201)

        const sitaId = sita.body.data.id
        const otherId = other.body.data.id

        const searchRes = await request(app)
            .get('/api/v1/customers')
            .set('Authorization', `Bearer ${cashierToken}`)
            .query({ search: 'stationery', status: 'ACTIVE' })
            .expect(200)

        expect(searchRes.body.data).toHaveLength(1)
        expect(searchRes.body.data[0].id).toBe(sitaId)

        // Omitted phone preserves existing phone.
        const patchName = await request(app)
            .patch(`/api/v1/customers/${sitaId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ company: 'Sita Enterprises' })
            .expect(200)

        expect(patchName.body.data.phone).toBe('9800000001')
        expect(patchName.body.data.company).toBe('Sita Enterprises')

        // Explicit null clears phone.
        const clearPhone = await request(app)
            .patch(`/api/v1/customers/${sitaId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ phone: null })
            .expect(200)

        expect(clearPhone.body.data.phone).toBeNull()

        // New customer stats: 0 orders and 0 NPR; missing UUID returns 404.
        const emptyStats = await request(app)
            .get(`/api/v1/customers/${sitaId}/stats`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)

        expect(emptyStats.body.data).toEqual({
            customerId: sitaId,
            completedOrderCount: 0,
            lifetimeSpendNpr: 0
        })

        await request(app)
            .get(`/api/v1/customers/${missingId}/stats`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(404)

        // Order fixtures: 1 completed (2000) + 1 refunded (800) for Sita, 1 completed (5000) for Ram.
        await db.order.createMany({
            data: [
                {
                    orderNumber: 'ORD-001',
                    customerId: sitaId,
                    cashierId: adminId,
                    subtotal: 2000,
                    total: 2000,
                    status: 'COMPLETED'
                },
                {
                    orderNumber: 'ORD-002',
                    customerId: sitaId,
                    cashierId,
                    subtotal: 800,
                    total: 800,
                    status: 'REFUNDED'
                },
                {
                    orderNumber: 'ORD-003',
                    customerId: otherId,
                    cashierId,
                    subtotal: 5000,
                    total: 5000,
                    status: 'COMPLETED'
                }
            ]
        })

        const stats = await request(app)
            .get(`/api/v1/customers/${sitaId}/stats`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)

        expect(stats.body.data).toEqual({
            customerId: sitaId,
            completedOrderCount: 1,
            lifetimeSpendNpr: 2000
        })
    })
})
