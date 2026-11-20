import type { PrismaClient } from '../generated/prisma/client.js';
import { ApiError } from '../errors/api-error.js';

export interface SalesOverview {
    orderCount: number;
    grossSales: number;
    discounts: number;
    tax: number;
    totalBilled: number;
    refundCount: number;
    refunds: number;
    netSales: number;
    averageOrderValue: number;
}

export async function getSalesOverview(
    db: PrismaClient,
    fromUTC: Date,
    toUTC: Date
): Promise<SalesOverview> {
    const [salesRow] = await db.$queryRaw<
        Array<{
            orderCount: number;
            grossSales: number;
            discounts: number;
            tax: number;
            totalBilled: number;
        }>
    >`
        SELECT 
            COUNT(*)::int AS "orderCount",
            COALESCE(SUM("subtotal"), 0)::int AS "grossSales",
            COALESCE(SUM("discount"), 0)::int AS "discounts",
            COALESCE(SUM("tax"), 0)::int AS "tax",
            COALESCE(SUM("total"), 0)::int AS "totalBilled"
        FROM "orders"
        WHERE "status" = 'COMPLETED'
          AND "created_at" >= ${fromUTC}
          AND "created_at" <= ${toUTC}
    `;

    const [refundRow] = await db.$queryRaw<
        Array<{
            refundCount: number;
            refunds: number;
        }>
    >`
        SELECT 
            COUNT(*)::int AS "refundCount",
            COALESCE(SUM("amount"), 0)::int AS "refunds"
        FROM "refunds"
        WHERE "created_at" >= ${fromUTC}
          AND "created_at" <= ${toUTC}
    `;

    const orderCount = salesRow?.orderCount ?? 0;
    const grossSales = salesRow?.grossSales ?? 0;
    const discounts = salesRow?.discounts ?? 0;
    const tax = salesRow?.tax ?? 0;
    const totalBilled = salesRow?.totalBilled ?? 0;
    const refundCount = refundRow?.refundCount ?? 0;
    const refunds = refundRow?.refunds ?? 0;

    const netSales = totalBilled - refunds;
    const averageOrderValue = orderCount > 0 ? Math.round(totalBilled / orderCount) : 0;

    return {
        orderCount,
        grossSales,
        discounts,
        tax,
        totalBilled,
        refundCount,
        refunds,
        netSales,
        averageOrderValue,
    };
}

export async function getOrderHistory(
    db: PrismaClient,
    params: {
        fromUTC: Date;
        toUTC: Date;
        status?: 'COMPLETED' | 'REFUNDED';
        page: number;
        limit: number;
    }
) {
    const { fromUTC, toUTC, status, page, limit } = params;
    const skip = (page - 1) * limit;

    const where = {
        createdAt: {
            gte: fromUTC,
            lte: toUTC,
        },
        ...(status ? { status } : {}),
    };

    const [total, orders] = await Promise.all([
        db.order.count({ where }),
        db.order.findMany({
            where,
            include: {
                items: {
                    orderBy: { productId: 'asc' },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
                cashier: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
                refund: {
                    select: {
                        id: true,
                        amount: true,
                        reason: true,
                        restocked: true,
                        createdAt: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
    ]);

    return {
        orders,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

export interface TopProduct {
    productId: string;
    productName: string;
    productSku: string;
    totalQuantity: number;
    totalRevenue: number;
}

export async function getTopProducts(
    db: PrismaClient,
    fromUTC: Date,
    toUTC: Date,
    metric: 'QUANTITY' | 'REVENUE',
    limit: number
): Promise<TopProduct[]> {
    if (metric === 'REVENUE') {
        return db.$queryRaw<TopProduct[]>`
            SELECT 
                oi."product_id" AS "productId",
                oi."product_name" AS "productName",
                oi."product_sku" AS "productSku",
                SUM(oi."quantity")::int AS "totalQuantity",
                SUM(oi."line_total")::int AS "totalRevenue"
            FROM "order_items" oi
            JOIN "orders" o ON o."id" = oi."order_id"
            WHERE o."status" = 'COMPLETED'
              AND o."created_at" >= ${fromUTC}
              AND o."created_at" <= ${toUTC}
            GROUP BY oi."product_id", oi."product_name", oi."product_sku"
            ORDER BY SUM(oi."line_total") DESC, oi."product_id" ASC
            LIMIT ${limit}
        `;
    }

    return db.$queryRaw<TopProduct[]>`
        SELECT 
            oi."product_id" AS "productId",
            oi."product_name" AS "productName",
            oi."product_sku" AS "productSku",
            SUM(oi."quantity")::int AS "totalQuantity",
            SUM(oi."line_total")::int AS "totalRevenue"
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."order_id"
        WHERE o."status" = 'COMPLETED'
          AND o."created_at" >= ${fromUTC}
          AND o."created_at" <= ${toUTC}
        GROUP BY oi."product_id", oi."product_name", oi."product_sku"
        ORDER BY SUM(oi."quantity") DESC, oi."product_id" ASC
        LIMIT ${limit}
    `;
}

export async function getCustomerAnalytics(db: PrismaClient, customerId: string) {
    const customer = await db.customer.findUnique({
        where: { id: customerId },
    });

    if (!customer) {
        throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }

    const [statsRow] = await db.$queryRaw<
        Array<{
            orderCount: number;
            totalSpend: number;
            averageOrderValue: number;
        }>
    >`
        SELECT 
            COUNT(*)::int AS "orderCount",
            COALESCE(SUM("total"), 0)::int AS "totalSpend",
            COALESCE(AVG("total"), 0)::int AS "averageOrderValue"
        FROM "orders"
        WHERE "customer_id" = ${customerId}::uuid
          AND "status" = 'COMPLETED'
    `;

    const [refundedOrdersRow] = await db.$queryRaw<
        Array<{
            refundedCount: number;
        }>
    >`
        SELECT 
            COUNT(*)::int AS "refundedCount"
        FROM "orders"
        WHERE "customer_id" = ${customerId}::uuid
          AND "status" = 'REFUNDED'
    `;

    const recentOrders = await db.order.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
            items: {
                orderBy: { productId: 'asc' },
            },
            refund: true,
        },
    });

    return {
        customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            status: customer.status,
            createdAt: customer.createdAt,
        },
        stats: {
            lifetimeOrders: statsRow?.orderCount ?? 0,
            lifetimeSpend: statsRow?.totalSpend ?? 0,
            averageOrderValue: statsRow?.averageOrderValue ?? 0,
            refundedOrdersCount: refundedOrdersRow?.refundedCount ?? 0,
        },
        recentOrders,
    };
}

export async function getLowStockReport(db: PrismaClient, page: number, limit: number) {
    const offset = (page - 1) * limit;

    const [countRow] = await db.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS "total"
        FROM "products"
        WHERE "is_active" = true 
          AND "stock_quantity" <= "low_stock_threshold"
    `;
    const total = countRow?.total ?? 0;

    const products = await db.$queryRaw<
        Array<{
            id: string;
            name: string;
            sku: string;
            price: number;
            costPrice: number | null;
            stockQuantity: number;
            lowStockThreshold: number;
        }>
    >`
        SELECT 
            "id",
            "name",
            "sku",
            "price",
            "cost_price" AS "costPrice",
            "stock_quantity" AS "stockQuantity",
            "low_stock_threshold" AS "lowStockThreshold"
        FROM "products"
        WHERE "is_active" = true 
          AND "stock_quantity" <= "low_stock_threshold"
        ORDER BY "stock_quantity" ASC, "name" ASC
        LIMIT ${limit} OFFSET ${offset}
    `;

    return {
        products,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}
