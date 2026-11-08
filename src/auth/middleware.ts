import type {
    RequestHandler,
    Response
} from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../errors/api-error.js'
import type { AuthConfig } from './config.js'
import { verifyAccessToken } from './token.js'

export type AuthContext = {
    sessionId: string
    user: {
        id: string
        email: string
        role: 'ADMIN' | 'CASHIER'
    }
}

export function currentAuth(res: Response): AuthContext {
    const auth = res.locals.auth as AuthContext | undefined

    if (!auth) {
        throw new ApiError(
            401,
            'AUTHENTICATION_REQUIRED',
            'Authentication is required'
        )
    }

    return auth
}

export function createRequireAuth(
    db: PrismaClient,
    config: AuthConfig
): RequestHandler {
    return async (req, res, next) => {
        const authorization = req.get('Authorization')
        const match = authorization?.match(/^Bearer ([^\s]+)$/i)

        if (!match) {
            throw new ApiError(
                401,
                'AUTHENTICATION_REQUIRED',
                'A Bearer access token is required'
            )
        }

        const identity = await verifyAccessToken(match[1], config)

        const session = await db.session.findFirst({
            where: {
                id: identity.sid,
                userId: identity.sub,
                expiresAt: {
                    gt: new Date()
                }
            },

            select: {
                id: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        isActive: true
                    }
                }
            }
        })

        if (!session || !session.user.isActive) {
            throw new ApiError(
                401,
                'INVALID_SESSION',
                'Session is invalid or expired'
            )
        }

        res.locals.auth = {
            sessionId: session.id,
            user: {
                id: session.user.id,
                email: session.user.email,
                role: session.user.role
            }
        } satisfies AuthContext

        next()
    }
}

export const requireAdmin: RequestHandler = (req, res, next) => {
    const auth = currentAuth(res)

    if (auth.user.role !== 'ADMIN') {
        throw new ApiError(
            403,
            'FORBIDDEN',
            'Admin permission is required'
        )
    }

    next()
}