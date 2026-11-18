import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { parseReportDateRange } from './date-utils.js';
import {
    dateRangeSchema,
    orderHistoryQuerySchema,
    topProductsSchema,
    paginationSchema,
    customerAnalyticsParamsSchema,
} from './schemas.js';
import {
    getSalesOverview,
    getOrderHistory,
    getTopProducts,
    getCustomerAnalytics,
    getLowStockReport,
} from './service.js';

export function createAnalyticsRouter(db: PrismaClient) {
    const router = Router();

    // 1. Sales Overview
    router.get('/overview', async (req, res) => {
        const query = dateRangeSchema.parse(req.query);
        const { fromUTC, toUTC } = parseReportDateRange(query.startDate, query.endDate);
        const overview = await getSalesOverview(db, fromUTC, toUTC);

        res.json({ data: overview });
    });

    // 2. Order History with bounded dates & pagination
    router.get('/orders', async (req, res) => {
        const query = orderHistoryQuerySchema.parse(req.query);
        const { fromUTC, toUTC } = parseReportDateRange(query.startDate, query.endDate);
        const result = await getOrderHistory(db, {
            fromUTC,
            toUTC,
            status: query.status,
            page: query.page,
            limit: query.limit,
        });

        res.json({
            data: result.orders,
            pagination: result.pagination,
        });
    });

    // 3. Top-selling products
    router.get('/top-products', async (req, res) => {
        const query = topProductsSchema.parse(req.query);
        const { fromUTC, toUTC } = parseReportDateRange(query.startDate, query.endDate);
        const products = await getTopProducts(db, fromUTC, toUTC, query.metric, query.limit);

        res.json({ data: products });
    });

    // 4. Customer lifetime analytics
    router.get('/customers/:id', async (req, res) => {
        const params = customerAnalyticsParamsSchema.parse(req.params);
        const analytics = await getCustomerAnalytics(db, params.id);

        res.json({ data: analytics });
    });

    // 5. Low-stock reporting
    router.get('/low-stock', async (req, res) => {
        const query = paginationSchema.parse(req.query);
        const report = await getLowStockReport(db, query.page, query.limit);

        res.json({
            data: report.products,
            pagination: report.pagination,
        });
    });

    return router;
}
