import { randomBytes, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabaseClient } from '../src/db/client.js';
import { loadAuthConfig, type AuthConfig } from '../src/auth/config.js';
import { hashPassword } from '../src/auth/password.js';

config({ path: '.env.test', override: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('Test DATABASE_URL is missing');
}

const url = new URL(connectionString);
if (url.hostname !== 'localhost' || url.pathname !== '/retailflow_test') {
    throw new Error('Refusing to reset a non-test database');
}

const db = createDatabaseClient(connectionString);

let app: ReturnType<typeof createApp>;
let authConfig: AuthConfig;
let adminPasswordHash: string;
let adminToken: string;
let cashierToken: string;
let adminUserId: string;
let cashierUserId: string;
const password = 'A long test administrator passphrase';

const prodAId = '11111111-0000-4000-8000-000000000001';
const prodBId = '22222222-0000-4000-8000-000000000002';
const custId = '33333333-0000-4000-8000-000000000003';

beforeAll(async () => {
    await db.$connect();

    const rows = await db.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name
    `;
    if (rows[0]?.name !== 'retailflow_test') {
        throw new Error('Connected database is not retailflow_test');
    }

    authConfig = await loadAuthConfig({
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://localhost:5173',
        JWT_SECRET_BASE64: randomBytes(32).toString('base64'),
    });
    adminPasswordHash = await hashPassword(password);
});

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
        db.product.deleteMany(),
    ]);

    const adminUser = await db.user.create({
        data: {
            email: 'admin_analytics@example.com',
            passwordHash: adminPasswordHash,
            role: 'ADMIN',
        },
    });
    adminUserId = adminUser.id;

    const cashierUser = await db.user.create({
        data: {
            email: 'cashier_analytics@example.com',
            passwordHash: adminPasswordHash,
            role: 'CASHIER',
        },
    });
    cashierUserId = cashierUser.id;

    app = createApp(db, authConfig);

    const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email: 'admin_analytics@example.com', password })
        .expect(200);
    adminToken = adminLogin.body.data.accessToken;

    const cashierLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email: 'cashier_analytics@example.com', password })
        .expect(200);
    cashierToken = cashierLogin.body.data.accessToken;
});

afterAll(async () => {
    await db.$disconnect();
});

describe('Phase 8 — Analytics and Query Performance', () => {
    it('calculates sales overview matching hand-calculated fixture down to the rupee', async () => {
        // Setup Products
        await db.product.createMany({
            data: [
                { id: prodAId, name: 'Keyboard', sku: 'KB-1', price: 2000, stockQuantity: 20 },
                { id: prodBId, name: 'Mouse', sku: 'MS-1', price: 1000, stockQuantity: 20 },
            ],
        });

        // Setup Customer
        await db.customer.create({
            data: { id: custId, name: 'Sita Sharma', status: 'ACTIVE' },
        });

        // Order 1: Jan 10, 2026 (Completed)
        // 2x Keyboard = 4000 subtotal, 0 discount, 200 tax (5%), 4200 total
        const order1 = await db.order.create({
            data: {
                orderNumber: 'RF-TEST-001',
                customerId: custId,
                cashierId: cashierUserId,
                subtotal: 4000,
                discount: 0,
                tax: 200,
                total: 4200,
                status: 'COMPLETED',
                createdAt: new Date('2026-01-10T10:00:00.000+05:45'),
                items: {
                    create: [
                        {
                            productId: prodAId,
                            productName: 'Keyboard',
                            productSku: 'KB-1',
                            unitPrice: 2000,
                            quantity: 2,
                            lineTotal: 4000,
                        },
                    ],
                },
            },
        });

        // Order 2: Jan 12, 2026 (Completed)
        // 3x Keyboard = 6000 subtotal, 600 discount (10%), 270 tax (5%), 5670 total
        await db.order.create({
            data: {
                orderNumber: 'RF-TEST-002',
                customerId: custId,
                cashierId: cashierUserId,
                subtotal: 6000,
                discount: 600,
                tax: 270,
                total: 5670,
                status: 'COMPLETED',
                createdAt: new Date('2026-01-12T10:00:00.000+05:45'),
                items: {
                    create: [
                        {
                            productId: prodAId,
                            productName: 'Keyboard',
                            productSku: 'KB-1',
                            unitPrice: 2000,
                            quantity: 3,
                            lineTotal: 6000,
                        },
                    ],
                },
            },
        });

        // Order 3: Jan 14, 2026 (Refunded)
        // 1x Mouse = 1000 subtotal, 0 discount, 50 tax, 1050 total
        const order3 = await db.order.create({
            data: {
                orderNumber: 'RF-TEST-003',
                customerId: custId,
                cashierId: cashierUserId,
                subtotal: 1000,
                discount: 0,
                tax: 50,
                total: 1050,
                status: 'REFUNDED',
                createdAt: new Date('2026-01-14T10:00:00.000+05:45'),
                items: {
                    create: [
                        {
                            productId: prodBId,
                            productName: 'Mouse',
                            productSku: 'MS-1',
                            unitPrice: 1000,
                            quantity: 1,
                            lineTotal: 1000,
                        },
                    ],
                },
            },
        });

        // Issue refund for Order 3
        await db.refund.create({
            data: {
                orderId: order3.id,
                actorId: adminUserId,
                amount: 1050,
                reason: 'Customer return',
                restocked: true,
                createdAt: new Date('2026-01-14T12:00:00.000+05:45'),
            },
        });

        // Query Overview for Jan 01 - Jan 20
        const res = await request(app)
            .get('/api/v1/analytics/overview?startDate=2026-01-01&endDate=2026-01-20')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        const overview = res.body.data;
        expect(overview.orderCount).toBe(2);
        expect(overview.grossSales).toBe(10000); // 4000 + 6000
        expect(overview.discounts).toBe(600); // 0 + 600
        expect(overview.tax).toBe(470); // 200 + 270
        expect(overview.totalBilled).toBe(9870); // 4200 + 5670
        expect(overview.refundCount).toBe(1);
        expect(overview.refunds).toBe(1050);
        expect(overview.netSales).toBe(8820); // 9870 - 1050
        expect(overview.averageOrderValue).toBe(4935); // 9870 / 2
    });

    it('respects Kathmandu shop timezone boundaries for midnight transactions', async () => {
        await db.product.create({
            data: { id: prodAId, name: 'Keyboard', sku: 'KB-1', price: 1000, stockQuantity: 20 },
        });

        // Jan 15 at 23:45 Kathmandu time (+05:45) is Jan 15 18:00 UTC.
        // It belongs to Jan 15 in Kathmandu!
        await db.order.create({
            data: {
                orderNumber: 'RF-TZ-1',
                cashierId: cashierUserId,
                subtotal: 1000,
                tax: 50,
                total: 1050,
                status: 'COMPLETED',
                createdAt: new Date('2026-01-15T23:45:00.000+05:45'),
            },
        });

        // Jan 16 at 00:05 Kathmandu time (+05:45) is Jan 15 18:20 UTC.
        // It belongs to Jan 16 in Kathmandu!
        await db.order.create({
            data: {
                orderNumber: 'RF-TZ-2',
                cashierId: cashierUserId,
                subtotal: 2000,
                tax: 100,
                total: 2100,
                status: 'COMPLETED',
                createdAt: new Date('2026-01-16T00:05:00.000+05:45'),
            },
        });

        // Query ONLY Jan 15
        const resJan15 = await request(app)
            .get('/api/v1/analytics/overview?startDate=2026-01-15&endDate=2026-01-15')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(resJan15.body.data.orderCount).toBe(1);
        expect(resJan15.body.data.totalBilled).toBe(1050);

        // Query ONLY Jan 16
        const resJan16 = await request(app)
            .get('/api/v1/analytics/overview?startDate=2026-01-16&endDate=2026-01-16')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(resJan16.body.data.orderCount).toBe(1);
        expect(resJan16.body.data.totalBilled).toBe(2100);
    });

    it('returns paginated order history with bounded date filtering', async () => {
        for (let i = 1; i <= 5; i++) {
            await db.order.create({
                data: {
                    orderNumber: `RF-HIST-${i}`,
                    cashierId: cashierUserId,
                    subtotal: 1000 * i,
                    tax: 50 * i,
                    discount: 0,
                    total: 1050 * i,
                    status: i === 5 ? 'REFUNDED' : 'COMPLETED',
                    createdAt: new Date(`2026-02-0${i}T10:00:00.000+05:45`),
                },
            });
        }

        // Page 1, limit 2
        const res = await request(app)
            .get('/api/v1/analytics/orders?startDate=2026-02-01&endDate=2026-02-10&page=1&limit=2')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(res.body.data).toHaveLength(2);
        expect(res.body.pagination.total).toBe(5);
        expect(res.body.pagination.page).toBe(1);
        expect(res.body.pagination.limit).toBe(2);
        expect(res.body.pagination.totalPages).toBe(3);

        // Filter by status=COMPLETED
        const completedRes = await request(app)
            .get('/api/v1/analytics/orders?startDate=2026-02-01&endDate=2026-02-10&status=COMPLETED')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(completedRes.body.data).toHaveLength(4);
        expect(completedRes.body.pagination.total).toBe(4);
    });

    it('aggregates top-selling products by quantity and revenue correctly', async () => {
        await db.product.createMany({
            data: [
                { id: prodAId, name: 'Expensive Laptop', sku: 'LAP-1', price: 50000, stockQuantity: 10 },
                { id: prodBId, name: 'Cheap Mousepad', sku: 'PAD-1', price: 200, stockQuantity: 100 },
            ],
        });

        // Order 1: 1 Laptop (Quantity: 1, Revenue: 50,000)
        await db.order.create({
            data: {
                orderNumber: 'RF-TOP-1',
                cashierId: cashierUserId,
                subtotal: 50000,
                total: 50000,
                status: 'COMPLETED',
                createdAt: new Date('2026-03-01T10:00:00.000+05:45'),
                items: {
                    create: [
                        {
                            productId: prodAId,
                            productName: 'Expensive Laptop',
                            productSku: 'LAP-1',
                            unitPrice: 50000,
                            quantity: 1,
                            lineTotal: 50000,
                        },
                    ],
                },
            },
        });

        // Order 2: 20 Mousepads (Quantity: 20, Revenue: 4,000)
        await db.order.create({
            data: {
                orderNumber: 'RF-TOP-2',
                cashierId: cashierUserId,
                subtotal: 4000,
                total: 4000,
                status: 'COMPLETED',
                createdAt: new Date('2026-03-02T10:00:00.000+05:45'),
                items: {
                    create: [
                        {
                            productId: prodBId,
                            productName: 'Cheap Mousepad',
                            productSku: 'PAD-1',
                            unitPrice: 200,
                            quantity: 20,
                            lineTotal: 4000,
                        },
                    ],
                },
            },
        });

        // Top products by QUANTITY: Mousepad should be #1 (20 units vs 1 unit)
        const qtyRes = await request(app)
            .get('/api/v1/analytics/top-products?startDate=2026-03-01&endDate=2026-03-05&metric=QUANTITY')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(qtyRes.body.data[0].productName).toBe('Cheap Mousepad');
        expect(qtyRes.body.data[0].totalQuantity).toBe(20);

        // Top products by REVENUE: Laptop should be #1 (50,000 NPR vs 4,000 NPR)
        const revRes = await request(app)
            .get('/api/v1/analytics/top-products?startDate=2026-03-01&endDate=2026-03-05&metric=REVENUE')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(revRes.body.data[0].productName).toBe('Expensive Laptop');
        expect(revRes.body.data[0].totalRevenue).toBe(50000);
    });

    it('returns customer lifetime spending and purchase history', async () => {
        const customer = await db.customer.create({
            data: { id: custId, name: 'Hari Bahadur', status: 'ACTIVE' },
        });

        await db.order.create({
            data: {
                orderNumber: 'RF-CUST-1',
                customerId: customer.id,
                cashierId: cashierUserId,
                subtotal: 5000,
                tax: 250,
                discount: 0,
                total: 5250,
                status: 'COMPLETED',
            },
        });

        await db.order.create({
            data: {
                orderNumber: 'RF-CUST-2',
                customerId: customer.id,
                cashierId: cashierUserId,
                subtotal: 3000,
                tax: 150,
                discount: 0,
                total: 3150,
                status: 'COMPLETED',
            },
        });

        const res = await request(app)
            .get(`/api/v1/analytics/customers/${customer.id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(res.body.data.customer.name).toBe('Hari Bahadur');
        expect(res.body.data.stats.lifetimeOrders).toBe(2);
        expect(res.body.data.stats.lifetimeSpend).toBe(8400); // 5250 + 3150
        expect(res.body.data.stats.averageOrderValue).toBe(4200);
        expect(res.body.data.recentOrders).toHaveLength(2);
    });

    it('returns low-stock products sorted by stock quantity ascending', async () => {
        await db.product.createMany({
            data: [
                { name: 'Low Stock Item A', sku: 'LOW-A', price: 100, stockQuantity: 2, lowStockThreshold: 5 },
                { name: 'Low Stock Item B', sku: 'LOW-B', price: 100, stockQuantity: 4, lowStockThreshold: 5 },
                { name: 'Adequate Stock Item', sku: 'HIGH-C', price: 100, stockQuantity: 15, lowStockThreshold: 5 },
            ],
        });

        const res = await request(app)
            .get('/api/v1/analytics/low-stock?page=1&limit=10')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].sku).toBe('LOW-A');
        expect(res.body.data[1].sku).toBe('LOW-B');
        expect(res.body.pagination.total).toBe(2);
    });

    it('forbids cashiers from viewing any analytics endpoints (403)', async () => {
        await request(app)
            .get('/api/v1/analytics/overview')
            .set('Authorization', `Bearer ${cashierToken}`)
            .expect(403);

        await request(app)
            .get('/api/v1/analytics/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .expect(403);

        await request(app)
            .get('/api/v1/analytics/top-products')
            .set('Authorization', `Bearer ${cashierToken}`)
            .expect(403);

        await request(app)
            .get(`/api/v1/analytics/customers/${custId}`)
            .set('Authorization', `Bearer ${cashierToken}`)
            .expect(403);

        await request(app)
            .get('/api/v1/analytics/low-stock')
            .set('Authorization', `Bearer ${cashierToken}`)
            .expect(403);
    });

    it('rejects invalid dates and date ranges exceeding 90 days (400)', async () => {
        // Unparseable date
        await request(app)
            .get('/api/v1/analytics/overview?startDate=2026-99-99&endDate=2026-01-10')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(400);

        // startDate > endDate
        await request(app)
            .get('/api/v1/analytics/overview?startDate=2026-02-10&endDate=2026-02-01')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(400);

        // Date range > 90 days (Jan 1 to May 1 is ~120 days)
        const rangeRes = await request(app)
            .get('/api/v1/analytics/overview?startDate=2026-01-01&endDate=2026-05-01')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(400);

        expect(rangeRes.body.error.code).toBe('DATE_RANGE_TOO_LARGE');
    });
});
