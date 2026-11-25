import { z } from 'zod';
import dotenv from 'dotenv';

// 1. In local development, load from .env file.
// In production, the cloud host (Docker/Render) injects them directly into process.env.
dotenv.config();

// 2. Define the strict schema of everything the backend needs to run
const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),

    PORT: z.coerce
        .number()
        .int()
        .min(1024)
        .max(65535)
        .default(4000),

    DATABASE_URL: z
        .string()
        .url('DATABASE_URL must be a valid PostgreSQL connection URL'),

    JWT_SECRET_BASE64: z
        .string()
        .min(32, 'JWT_SECRET_BASE64 must be at least 32 characters for 256-bit security'),

    APP_ORIGIN: z
        .string()
        .url('APP_ORIGIN must be a valid URL (e.g., http://localhost:5173 or https://pos.store.com)'),
});

export type EnvConfig = z.infer<typeof envSchema>;

// 3. The startup validator function
export function validateEnv(): EnvConfig {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ FATAL: Invalid application environment configuration:');
        for (const [field, errors] of Object.entries(result.error.flatten().fieldErrors)) {
            console.error(`  - ${field}: ${errors?.join(', ')}`);
        }
        // Exit immediately so container orchestrator knows the deployment failed!
        process.exit(1);
    }

    return result.data;
}