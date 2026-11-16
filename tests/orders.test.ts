import { randomBytes, randomUUID } from 'node:crypto'
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

function sendCart(
    items: { productId: string; quantity: number }[],
    token = adminToken,
    customerId?: string | null,
    idempotencyKey?: string | null
) {
    const key = idempotencyKey === undefined ? randomUUID() : idempotencyKey
    const req = request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Protection', '1')

    if (key !== null) {
        req.set('Idempotency-Key', key)
    }

    return req.send({
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
        db.auditEvent.deleteMany(),
        db.refund.deleteMany(),
        db.checkoutAttempt.deleteMany(),
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

    describe('Phase 7 — Safe retries, refunds, and audit history', () => {
        it('rejects checkout request without Idempotency-Key (400)', async () => {
            await fixtureProduct(firstId, 'P7-NO-KEY', 5)

            const res = await sendCart([{ productId: firstId, quantity: 1 }], adminToken, undefined, null).expect(400)
            expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY')
        })

        it('replays identical checkout cleanly without duplicate charges or stock drops (200)', async () => {
            await fixtureProduct(firstId, 'P7-REPLAY', 10, 2000)
            const key = randomUUID()

            // First attempt: creates order (201)
            const firstRes = await sendCart([{ productId: firstId, quantity: 2 }], cashierToken, undefined, key).expect(201)
            expect(firstRes.header['idempotency-replayed']).toBeUndefined()
            const orderId = firstRes.body.data.id

            const productAfterFirst = await db.product.findUniqueOrThrow({ where: { id: firstId } })
            expect(productAfterFirst.stockQuantity).toBe(8)
            expect(await db.order.count()).toBe(1)

            // Second attempt with exact same key and cart: returns original order (200)
            const secondRes = await sendCart([{ productId: firstId, quantity: 2 }], cashierToken, undefined, key).expect(200)
            expect(secondRes.header['idempotency-replayed']).toBe('true')
            expect(secondRes.body.data.id).toBe(orderId)
            expect(secondRes.body.data.total).toBe(firstRes.body.data.total)

            // Stock must still be 8, not 6!
            const productAfterSecond = await db.product.findUniqueOrThrow({ where: { id: firstId } })
            expect(productAfterSecond.stockQuantity).toBe(8)
            expect(await db.order.count()).toBe(1)
        })

        it('rejects reused key with different cart payload (409)', async () => {
            await fixtureProduct(firstId, 'P7-DIFF-1', 10, 2000)
            await fixtureProduct(secondId, 'P7-DIFF-2', 10, 1000)
            const key = randomUUID()

            // First attempt with 1 keyboard
            await sendCart([{ productId: firstId, quantity: 1 }], cashierToken, undefined, key).expect(201)

            // Second attempt with same key but 2 keyboards: conflict!
            const conflictRes = await sendCart([{ productId: firstId, quantity: 2 }], cashierToken, undefined, key).expect(409)
            expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')

            // Third attempt with same key but different product: conflict!
            const conflictRes2 = await sendCart([{ productId: secondId, quantity: 1 }], cashierToken, undefined, key).expect(409)
            expect(conflictRes2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
        })

        it('allows admin to fully refund an order with restock (201)', async () => {
            await fixtureProduct(firstId, 'P7-REFUND-RESTOCK', 10, 2000)
            const checkoutRes = await sendCart([{ productId: firstId, quantity: 2 }]).expect(201)
            const orderId = checkoutRes.body.data.id

            // Stock is 8 after sale
            expect((await db.product.findUniqueOrThrow({ where: { id: firstId } })).stockQuantity).toBe(8)

            // Admin refunds order with restock = true
            const refundRes = await request(app)
                .post(`/api/v1/orders/${orderId}/refund`)
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send({
                    reason: 'Customer requested return and items are intact',
                    restock: true
                })
                .expect(201)

            expect(refundRes.body.data.orderId).toBe(orderId)
            expect(refundRes.body.data.amount).toBe(checkoutRes.body.data.total)
            expect(refundRes.body.data.restocked).toBe(true)

            // Order status is now REFUNDED
            const order = await db.order.findUniqueOrThrow({ where: { id: orderId } })
            expect(order.status).toBe('REFUNDED')

            // Product stock restored to 10
            const product = await db.product.findUniqueOrThrow({ where: { id: firstId } })
            expect(product.stockQuantity).toBe(10)

            // REFUND_RESTOCK movement recorded
            const restockMovement = await db.inventoryMovement.findFirstOrThrow({
                where: { orderId, kind: 'REFUND_RESTOCK' }
            })
            expect(restockMovement.delta).toBe(2)
        })

        it('allows admin to fully refund an order without restock (201)', async () => {
            await fixtureProduct(firstId, 'P7-REFUND-NO-RESTOCK', 10, 2000)
            const checkoutRes = await sendCart([{ productId: firstId, quantity: 2 }]).expect(201)
            const orderId = checkoutRes.body.data.id

            // Admin refunds order with restock = false
            await request(app)
                .post(`/api/v1/orders/${orderId}/refund`)
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send({
                    reason: 'Items were damaged by customer',
                    restock: false
                })
                .expect(201)

            // Order status is REFUNDED
            const order = await db.order.findUniqueOrThrow({ where: { id: orderId } })
            expect(order.status).toBe('REFUNDED')

            // Stock remains 8 (not restored)
            const product = await db.product.findUniqueOrThrow({ where: { id: firstId } })
            expect(product.stockQuantity).toBe(8)

            // No REFUND_RESTOCK movement
            const restockCount = await db.inventoryMovement.count({
                where: { orderId, kind: 'REFUND_RESTOCK' }
            })
            expect(restockCount).toBe(0)
        })

        it('rejects duplicate refund attempt on the same order (409)', async () => {
            await fixtureProduct(firstId, 'P7-DOUBLE-REFUND', 10, 2000)
            const checkoutRes = await sendCart([{ productId: firstId, quantity: 2 }]).expect(201)
            const orderId = checkoutRes.body.data.id

            // First refund succeeds
            await request(app)
                .post(`/api/v1/orders/${orderId}/refund`)
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send({ reason: 'Initial return', restock: true })
                .expect(201)

            // Second refund attempt fails (409)
            const duplicateRes = await request(app)
                .post(`/api/v1/orders/${orderId}/refund`)
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send({ reason: 'Accidental second click', restock: true })
                .expect(409)

            expect(duplicateRes.body.error.code).toBe('ORDER_ALREADY_REFUNDED')

            // Stock was restored once (10), not twice (12)
            const product = await db.product.findUniqueOrThrow({ where: { id: firstId } })
            expect(product.stockQuantity).toBe(10)
        })

        it('forbids cashiers from issuing refunds (403)', async () => {
            await fixtureProduct(firstId, 'P7-FORBIDDEN-REFUND', 10, 2000)
            const checkoutRes = await sendCart([{ productId: firstId, quantity: 1 }]).expect(201)
            const orderId = checkoutRes.body.data.id

            const res = await request(app)
                .post(`/api/v1/orders/${orderId}/refund`)
                .set('Authorization', `Bearer ${cashierToken}`)
                .set('X-CSRF-Protection', '1')
                .send({ reason: 'Unauthorized cashier refund attempt', restock: true })
                .expect(403)

            expect(res.body.error.code).toBe('FORBIDDEN')
        })

        it('records and retrieves full audit history for checkout and refund (200)', async () => {
            await fixtureProduct(firstId, 'P7-AUDIT', 10, 2000)
            const checkoutRes = await sendCart([{ productId: firstId, quantity: 1 }], cashierToken).expect(201)
            const orderId = checkoutRes.body.data.id

            // Admin issues refund
            await request(app)
                .post(`/api/v1/orders/${orderId}/refund`)
                .set('Authorization', `Bearer ${adminToken}`)
                .set('X-CSRF-Protection', '1')
                .send({ reason: 'Customer changed mind', restock: true })
                .expect(201)

            // Admin inspects audit history
            const auditRes = await request(app)
                .get(`/api/v1/orders/${orderId}/audit`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200)

            const events = auditRes.body.data
            expect(events).toHaveLength(2)

            // First event: CHECKOUT_COMPLETED by cashier
            expect(events[0].action).toBe('CHECKOUT_COMPLETED')
            expect(events[0].actor.role).toBe('CASHIER')
            expect(events[0].orderId).toBe(orderId)

            // Second event: ORDER_REFUNDED by admin
            expect(events[1].action).toBe('ORDER_REFUNDED')
            expect(events[1].actor.role).toBe('ADMIN')
            expect(events[1].orderId).toBe(orderId)

            // Cashier is forbidden from viewing audit trail (403)
            await request(app)
                .get(`/api/v1/orders/${orderId}/audit`)
                .set('Authorization', `Bearer ${cashierToken}`)
                .expect(403)
        })
    })
})
