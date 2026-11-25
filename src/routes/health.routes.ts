import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';

export function createHealthRouter(db: PrismaClient) {
    const router = Router();

    // 1. Liveness: Checks if Node.js process is alive (doesn't touch DB)
    router.get('/live', (_req, res) => {
        res.status(200).json({
            status: 'ok',
            uptimeSeconds: Math.floor(process.uptime()),
        });
    });

    // 2. Readiness: Checks if PostgreSQL is accepting queries
    router.get('/ready', async (_req, res) => {
        try {
            await db.$queryRaw`SELECT 1`;
            res.status(200).json({
                status: 'ready',
                database: 'connected',
            });
        } catch {
            res.status(503).json({
                status: 'unready',
                database: 'disconnected',
            });
        }
    });

    return router;
}