import { createHash, randomBytes } from 'node:crypto'
import { errors, jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'
import { ApiError } from '../errors/api-error.js'
import type { AuthConfig } from './config.js'

const identitySchema = z.object({
    sub: z.uuid(),
    sid: z.uuid()
})

export function newRefreshToken() {
    return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
}

export function signAccessToken(
    userId: string,
    sessionId: string,
    config: AuthConfig
) {
    return new SignJWT({ sid: sessionId })
        .setProtectedHeader({
            alg: 'HS256',
            typ: 'JWT'
        })
        .setSubject(userId)
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(config.jwtKey)
}

export async function verifyAccessToken(
    token: string,
    config: AuthConfig
) {
    try {
        const { payload } = await jwtVerify(token, config.jwtKey, {
            algorithms: ['HS256'],
            issuer: config.issuer,
            audience: config.audience,
            requiredClaims: ['sub', 'sid', 'exp', 'iat']
        })

        const identity = identitySchema.safeParse(payload)

        if (!identity.success) {
            throw new ApiError(
                401,
                'INVALID_ACCESS_TOKEN',
                'Access token is invalid or expired'
            )
        }

        return identity.data
    } catch (error) {
        if (error instanceof errors.JOSEError) {
            throw new ApiError(
                401,
                'INVALID_ACCESS_TOKEN',
                'Access token is invalid or expired'
            )
        }

        throw error
    }
}