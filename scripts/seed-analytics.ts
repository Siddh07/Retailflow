import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { createDatabaseClient } from '../src/db/client.js';

config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is missing');
}

// Simple deterministic PRNG (Mulberry32)
function mulberry32(seed: number) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const random = mulberry32(42);

function randInt(min: number, max: number): number {
    return Math.floor(random() * (max - min + 1)) + min;
}

async function main() {
    const db = createDatabaseClient(connectionString!);
    await db.$connect();

    console.log('Seeding synthetic analytics dataset...');

    // 1. Clean existing records in FK order
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

    // 2. Create Cashier and Admin
    const admin = await db.user.create({
        data: {
            email: 'admin_analytics@example.com',
            passwordHash: 'seeded_hash_not_used_directly',
            role: 'ADMIN',
        },
    });

    const cashier = await db.user.create({
        data: {
            email: 'cashier_analytics@example.com',
            passwordHash: 'seeded_hash_not_used_directly',
            role: 'CASHIER',
        },
    });

    // 3. Create 10 Customers
    const customers = [];
    for (let i = 1; i <= 10; i++) {
        const c = await db.customer.create({
            data: {
                name: `Customer ${i}`,
                email: `customer${i}@example.com`,
                phone: `980000000${i}`,
                status: 'ACTIVE',
            },
        });
        customers.push(c);
    }

    // 4. Create 15 Products
    const products = [];
    for (let i = 1; i <= 15; i++) {
        const price = randInt(5, 50) * 100; // 500 to 5000 NPR
        const p = await db.product.create({
            data: {
                name: `Product ${i}`,
                sku: `SKU-${1000 + i}`,
                price,
                stockQuantity: 100,
                lowStockThreshold: i <= 3 ? 150 : 5, // make some products low stock
                isActive: true,
            },
        });
        products.push(p);
    }

    // 5. Generate 100 Orders across the last 60 days
    const now = new Date();
    const orderStatuses: ('COMPLETED' | 'REFUNDED')[] = [];

    for (let i = 1; i <= 100; i++) {
        const daysAgo = randInt(1, 55);
        const orderDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        const customer = random() > 0.2 ? customers[randInt(0, customers.length - 1)] : null;

        // 1 to 3 items
        const numItems = randInt(1, 3);
        const selectedProducts = [...products].sort(() => random() - 0.5).slice(0, numItems);

        let subtotal = 0;
        const lines = selectedProducts.map((prod) => {
            const quantity = randInt(1, 3);
            const lineTotal = prod.price * quantity;
            subtotal += lineTotal;
            return {
                productId: prod.id,
                productName: prod.name,
                productSku: prod.sku,
                unitPrice: prod.price,
                quantity,
                lineTotal,
            };
        });

        const discount = subtotal >= 5000 ? Math.round(subtotal * 0.1) : 0;
        const tax = Math.round((subtotal - discount) * 0.05);
        const total = subtotal - discount + tax;

        const isRefunded = random() < 0.1; // ~10% refunded
        const status = isRefunded ? 'REFUNDED' : 'COMPLETED';
        orderStatuses.push(status);

        const order = await db.order.create({
            data: {
                orderNumber: `RF-SYNTH-${10000 + i}`,
                customerId: customer?.id ?? null,
                cashierId: cashier.id,
                subtotal,
                discount,
                tax,
                total,
                status,
                paymentMethod: 'CASH',
                createdAt: orderDate,
                items: {
                    create: lines,
                },
            },
        });

        if (isRefunded) {
            await db.refund.create({
                data: {
                    orderId: order.id,
                    actorId: admin.id,
                    amount: total,
                    reason: 'Synthetic test return',
                    restocked: false,
                    createdAt: new Date(orderDate.getTime() + 3600 * 1000),
                },
            });
        }
    }

    console.log(`✅ Seeded 100 orders successfully:`);
    console.log(`- Completed: ${orderStatuses.filter((s) => s === 'COMPLETED').length}`);
    console.log(`- Refunded: ${orderStatuses.filter((s) => s === 'REFUNDED').length}`);

    await db.$disconnect();
}

main().catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
});
