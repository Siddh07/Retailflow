import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants.js';

export const dateRangeSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const orderHistoryQuerySchema = dateRangeSchema.extend({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    status: z.enum(['COMPLETED', 'REFUNDED']).optional(),
});

export const topProductsSchema = dateRangeSchema.extend({
    metric: z.enum(['QUANTITY', 'REVENUE']).default('QUANTITY'),
    limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const topProductionSchema = topProductsSchema;

export const customerAnalyticsParamsSchema = z.object({
    id: z.uuid('Customer ID must be a valid UUID'),
});
