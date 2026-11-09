import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { hashPassword } from './password.js'

const environmentSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),

    APP_ORIGIN: z.url(),

    JWT_SECRET_BASE64: z
        .string()
        .regex(/^[A-Za-z0-9+/]{43}=$/, {
            message: 'Generate a 32-byte base64 signing secret'
        })
})

export async function loadAuthConfig(
    environment: NodeJS.ProcessEnv = process.env
) {
    const input = environmentSchema.parse(environment)
    const origin = new URL(input.APP_ORIGIN)

    if (origin.origin !== input.APP_ORIGIN) {
        throw new Error('APP_ORIGIN must contain only scheme, host, and port')
    }

    if (
        input.NODE_ENV === 'production' &&
        origin.protocol !== 'https:'
    ) {
        throw new Error('Production APP_ORIGIN must use HTTPS')
    }

    return {
        appOrigin: input.APP_ORIGIN,
        secureCookies: input.NODE_ENV === 'production',
        jwtKey: Buffer.from(input.JWT_SECRET_BASE64, 'base64'),
        issuer: 'retailflow-api',
        audience: 'retailflow-client',

        dummyPasswordHash: await hashPassword(
            randomBytes(32).toString('base64url')
        )
    }
}

export type AuthConfig = Awaited<ReturnType<typeof loadAuthConfig>>