import { randomBytes } from 'node:crypto'
import { config } from 'dotenv'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { loadAuthConfig, type AuthConfig } from '../src/auth/config.js'
import { hashPassword } from '../src/auth/password.js'

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
let cashierToken: string
let cashierId: string
let otherCashierToken: string
const password = 'A long test administrator passphrase'

const firstId = '10000000-0000-4000-8000-000000000001'
const secondId = '20000000-0000-4000-8000-000000000002'

async function fixtureProduct(id: string, sku: string, stock: number, price = 2000, isActive = true) {
    return db.product.create({
        data: {
            id,
            sku,
            name: sku,
            price,
            stockQuantity: stock,
            isActive,
            ...(stock > 0
                ? {
                      inventoryMovements: {
                          create: {
                              kind: 'OPENING' as const,
                              delta: stock,
                              reason: 'Checkout test opening stock'
                          }
                      }
                  }
                : {})
        }
    })
}

function sendCart(items: { productId: string; quantity: number }[], token = adminToken, customerId?: string | null) {
    return request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Protection', '1')
        .send({
            paymentMethod: 'CASH',
            items,
            ...(customerId !== undefined ? { customerId } : {})
        })
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
    adminPasswordHash = await hashPassword(password)
})

beforeEach(async () => {
    await db.$transaction([
        db.inventoryMovement.deleteMany(),
        db.session.deleteMany(),
        db.orderItem.deleteMany(),
        db.order.deleteMany(),
        db.customer.deleteMany(),
        db.user.deleteMany(),
        db.product.deleteMany()
    ])

    await db.user.create({
        data: {
            email: 'admin@example.com',
            passwordHash: adminPasswordHash,
            role: 'ADMIN'
        }
    })

    const cashierUser = await db.user.create({
        data: {
            email: 'cashier@example.com',
            passwordHash: adminPasswordHash,
            role: 'CASHIER'
        }
    })
    cashierId = cashierUser.id

    await db.user.create({
        data: {
            email: 'other_cashier@example.com',
            passwordHash: adminPasswordHash,
            role: 'CASHIER'
        }
    })

    app = createApp(db, authConfig)

    const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email: 'admin@example.com', password })
        .expect(200)
    adminToken = adminLogin.body.data.accessToken

    const cashierLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email: 'cashier@example.com', password })
        .expect(200)
    cashierToken = cashierLogin.body.data.accessToken

    const otherLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email: 'other_cashier@example.com', password })
        .expect(200)
    otherCashierToken = otherLogin.body.data.accessToken
})

afterAll(async () => {
    await db.$disconnect()
})

describe('Phase 6 — Reliable checkout', () => {
    it('processes a full valid sale with discount, tax, receipt snapshot, movements, and customer stats', async () => {
        const keyboard = await fixtureProduct(firstId, 'KEY-001', 10, 2000)
        const mouse = await fixtureProduct(secondId, 'MOU-001', 5, 1000)

        const customer = await db.customer.create({
            data: {
                name: 'Sita Shrestha',
                email: 'sita@example.com',
                status: 'ACTIVE'
            }
        })

        const res = await sendCart(
            [
                { productId: keyboard.id, quantity: 2 },
                { productId: mouse.id, quantity: 1 }
            ],
            cashierToken,
            customer.id
        ).expect(201)

        expect(res.body.data).toMatchObject({
            cashierId,
            customerId: customer.id,
            paymentMethod: 'CASH',
            status: 'COMPLETED',
            subtotal: 5000,
            discount: 500,
            tax: 225,
            total: 4725
        })

        expect(res.body.data.items).toHaveLength(2)
        expect(res.headers.location).toBe(`/api/v1/orders/${res.body.data.id}`)

        // Stock decreased
        const kbAfter = await db.product.findUniqueOrThrow({ where: { id: keyboard.id } })
        const mAfter = await db.product.findUniqueOrThrow({ where: { id: mouse.id } })
        expect(kbAfter.stockQuantity).toBe(8)
        expect(mAfter.stockQuantity).toBe(4)

        // Movements recorded with kind SALE and orderId
        const movements = await db.inventoryMovement.findMany({
            where: { orderId: res.body.data.id },
            orderBy: { productId: 'asc' }
        })
        expect(movements).toHaveLength(2)
        expect(movements[0]).toMatchObject({
            productId: firstId,
            actorId: cashierId,
            kind: 'SALE',
            delta: -2
        })
        expect(movements[1]).toMatchObject({
            productId: secondId,
            actorId: cashierId,
            kind: 'SALE',
            delta: -1
        })

        // Customer stats updated
        const stats = await request(app)
            .get(`/api/v1/customers/${customer.id}/stats`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)
        expect(stats.body.data).toEqual({
            customerId: customer.id,
            completedOrderCount: 1,
            lifetimeSpendNpr: 4725
        })
    })

    it('restores the first product when the second product is unavailable', async () => {
        await fixtureProduct(firstId, 'P6-FIRST', 3)
        await fixtureProduct(secondId, 'P6-SECOND', 0)

        const orderCountBefore = await db.order.count()

        await sendCart([
            { productId: firstId, quantity: 2 },
            { productId: secondId, quantity: 1 }
        ]).expect(409)

        const first = await db.product.findUniqueOrThrow({ where: { id: firstId } })
        expect(first.stockQuantity).toBe(3)
        expect(await db.order.count()).toBe(orderCountBefore)
        expect(
            await db.inventoryMovement.count({
                where: { productId: firstId, kind: 'SALE' }
            })
        ).toBe(0)
    })

    it('sells the final unit exactly once', async () => {
        await fixtureProduct(firstId, 'P6-LAST', 1)
        const orderCountBefore = await db.order.count()

        const items = [{ productId: firstId, quantity: 1 }]
        const responses = await Promise.all([sendCart(items), sendCart(items)])

        expect(responses.map((r) => r.status).sort()).toEqual([201, 409])

        const product = await db.product.findUniqueOrThrow({ where: { id: firstId } })
        expect(product.stockQuantity).toBe(0)
        expect(await db.order.count()).toBe(orderCountBefore + 1)

        const sales = await db.inventoryMovement.findMany({
            where: { productId: firstId, kind: 'SALE' }
        })
        expect(sales).toHaveLength(1)
        expect(sales[0].delta).toBe(-1)
        expect(sales[0].orderId).toBeTruthy()
    })

    it('keeps the checkout price on the receipt', async () => {
        await fixtureProduct(firstId, 'P6-PRICE', 3)

        const created = await sendCart([{ productId: firstId, quantity: 2 }]).expect(201)

        await db.product.update({
            where: { id: firstId },
            data: { price: 2400 }
        })

        const receipt = await request(app)
            .get(`/api/v1/orders/${created.body.data.id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)

        expect(receipt.body.data.items[0].unitPrice).toBe(2000)
        expect(receipt.body.data.items[0].lineTotal).toBe(4000)
        expect(receipt.body.data.total).toBe(4200)
    })

    it.each([
        { name: 'empty cart', body: { paymentMethod: 'CASH', items: [] } },
        {
            name: 'duplicate product entries',
            body: {
                paymentMethod: 'CASH',
                items: [
                    { productId: firstId, quantity: 1 },
                    { productId: firstId, quantity: 2 }
                ]
            }
        },
        {
            name: 'zero quantity',
            body: {
                paymentMethod: 'CASH',
                items: [{ productId: firstId, quantity: 0 }]
            }
        },
        {
            name: 'negative quantity',
            body: {
                paymentMethod: 'CASH',
                items: [{ productId: firstId, quantity: -2 }]
            }
        },
        {
            name: 'fractional quantity',
            body: {
                paymentMethod: 'CASH',
                items: [{ productId: firstId, quantity: 1.5 }]
            }
        },
        {
            name: 'unsupported payment method',
            body: {
                paymentMethod: 'CARD',
                items: [{ productId: firstId, quantity: 1 }]
            }
        }
    ])('rejects invalid cart ($name)', async ({ body }) => {
        await request(app)
            .post('/api/v1/orders/checkout')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send(body)
            .expect(400)
    })

    it('rejects client attempting to supply cashierId, total, or item-level unitPrice', async () => {
        await fixtureProduct(firstId, 'P6-STRICT', 5)

        await request(app)
            .post('/api/v1/orders/checkout')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Protection', '1')
            .send({
                paymentMethod: 'CASH',
                cashierId: '99999999-9999-4999-8999-999999999999',
                total: 10,
                items: [{ productId: firstId, quantity: 1, unitPrice: 1 }]
            })
            .expect(400)
    })

    it('rejects checkout of an archived product', async () => {
        await fixtureProduct(firstId, 'P6-ARCHIVED', 5, 1000, false)

        await sendCart([{ productId: firstId, quantity: 1 }]).expect(409)
    })

    it('rejects valid but unknown customer UUID with 404', async () => {
        await fixtureProduct(firstId, 'P6-CUST', 5)
        const unknownCust = '99999999-9999-4999-8999-999999999999'

        await sendCart([{ productId: firstId, quantity: 1 }], adminToken, unknownCust).expect(404)

        const product = await db.product.findUniqueOrThrow({ where: { id: firstId } })
        expect(product.stockQuantity).toBe(5)
    })

    it('allows walk-in sale when customerId is omitted', async () => {
        await fixtureProduct(firstId, 'P6-WALKIN', 5)

        const res = await sendCart([{ productId: firstId, quantity: 1 }]).expect(201)
        expect(res.body.data.customerId).toBeNull()
    })

    it('rolls back when valid cart exceeds an Int amount (422)', async () => {
        // Price 1 billion * quantity 3 exceeds MAX_DATABASE_INT (2,147,483,647)
        await fixtureProduct(firstId, 'P6-OVERFLOW', 5, 1_000_000_000)

        await sendCart([{ productId: firstId, quantity: 3 }]).expect(422)

        const product = await db.product.findUniqueOrThrow({ where: { id: firstId } })
        expect(product.stockQuantity).toBe(5)
        expect(await db.order.count()).toBe(0)
    })

    it('stores authenticated cashier identity and prevents other cashier from reading receipt', async () => {
        await fixtureProduct(firstId, 'P6-AUTH', 5)

        const res = await sendCart([{ productId: firstId, quantity: 1 }], cashierToken).expect(201)
        expect(res.body.data.cashierId).toBe(cashierId)

        // Creator cashier can read receipt
        await request(app)
            .get(`/api/v1/orders/${res.body.data.id}`)
            .set('Authorization', `Bearer ${cashierToken}`)
            .expect(200)

        // Admin can read receipt
        await request(app)
            .get(`/api/v1/orders/${res.body.data.id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)

        // Another cashier cannot read receipt (404)
        await request(app)
            .get(`/api/v1/orders/${res.body.data.id}`)
            .set('Authorization', `Bearer ${otherCashierToken}`)
            .expect(404)
    })

    it('applies 10% discount starting at exactly 5000 subtotal', async () => {
        // Subtotal 4999: discount 0, tax 250, total 5249
        await fixtureProduct(firstId, 'P6-4999', 5, 4999)
        const res4999 = await sendCart([{ productId: firstId, quantity: 1 }]).expect(201)
        expect(res4999.body.data.subtotal).toBe(4999)
        expect(res4999.body.data.discount).toBe(0)
        expect(res4999.body.data.tax).toBe(250)
        expect(res4999.body.data.total).toBe(5249)

        // Subtotal 5000: discount 500, tax 225, total 4725
        await fixtureProduct(secondId, 'P6-5000', 5, 5000)
        const res5000 = await sendCart([{ productId: secondId, quantity: 1 }]).expect(201)
        expect(res5000.body.data.subtotal).toBe(5000)
        expect(res5000.body.data.discount).toBe(500)
        expect(res5000.body.data.tax).toBe(225)
        expect(res5000.body.data.total).toBe(4725)
    })
})
