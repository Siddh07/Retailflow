import { Router, type CookieOptions } from 'express'
import { rateLimit } from 'express-rate-limit'
import type { PrismaClient } from '../generated/prisma/client.js'
import { ApiError } from '../errors/api-error.js'
import type { AuthConfig } from './config.js'
import { loginSchema } from './schemas.js'
import { verifyPassword } from './password.js'
import {
    hashRefreshToken,
    newRefreshToken,
    signAccessToken
} from './token.js'
import {
    createRequireAuth,
    currentAuth
} from './middleware.js'

const COOKIE_NAME = 'retailflow_refresh'
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

function validRefreshToken(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(value)
    )
}

function publicUser(user: {
    id: string
    email: string
    role: 'ADMIN' | 'CASHIER'
}) {
    return {
        id: user.id,
        email: user.email,
        role: user.role
    }
}

export function createAuthRouter(
    db: PrismaClient,
    config: AuthConfig
) {
    const router = Router()
    const requireAuth = createRequireAuth(db, config)

    const cookieOptions: CookieOptions = {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/api/v1/auth'
    }

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: {
            error: {
                code: 'TOO_MANY_LOGIN_ATTEMPTS',
                message: 'Too many login attempts. Try again later.'
            }
        }
    })

    const refreshLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 60,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: {
            error: {
                code: 'TOO_MANY_REFRESH_ATTEMPTS',
                message: 'Too many refresh attempts. Try again later.'
            }
        }
    })

    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store')
        next()
    })

    router.post('/login', loginLimiter, async (req, res) => {
        const input = loginSchema.parse(req.body)

        const user = await db.user.findUnique({
            where: {
                email: input.email
            }
        })

        const passwordMatches = await verifyPassword(
            user?.passwordHash ?? config.dummyPasswordHash,
            input.password
        )

        if (!user || !user.isActive || !passwordMatches) {
            throw new ApiError(
                401,
                'INVALID_CREDENTIALS',
                'Email or password is incorrect'
            )
        }

        const refreshToken = newRefreshToken()
        const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)

        const session = await db.session.create({
            data: {
                userId: user.id,
                tokenHash: hashRefreshToken(refreshToken),
                expiresAt
            }
        })

        const accessToken = await signAccessToken(
            user.id,
            session.id,
            config
        )

        res.cookie(COOKIE_NAME, refreshToken, {
            ...cookieOptions,
            expires: expiresAt
        })

        res.status(200).json({
            data: {
                accessToken,
                user: publicUser(user)
            }
        })
    })

    router.post('/refresh', refreshLimiter, async (req, res) => {
        const refreshToken: unknown = req.cookies?.[COOKIE_NAME]

        if (!validRefreshToken(refreshToken)) {
            throw new ApiError(
                401,
                'INVALID_REFRESH_TOKEN',
                'Refresh session is invalid or expired'
            )
        }

        const oldHash = hashRefreshToken(refreshToken)

        const session = await db.session.findUnique({
            where: {
                tokenHash: oldHash
            },

            include: {
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

        if (
            !session ||
            session.expiresAt <= new Date() ||
            !session.user.isActive
        ) {
            throw new ApiError(
                401,
                'INVALID_REFRESH_TOKEN',
                'Refresh session is invalid or expired'
            )
        }

        const nextRefreshToken = newRefreshToken()

        const accessToken = await signAccessToken(
            session.userId,
            session.id,
            config
        )

        const result = await db.session.updateMany({
            where: {
                id: session.id,
                tokenHash: oldHash,
                expiresAt: {
                    gt: new Date()
                },
                user: {
                    is: {
                        isActive: true
                    }
                }
            },

            data: {
                tokenHash: hashRefreshToken(nextRefreshToken)
            }
        })

        if (result.count !== 1) {
            throw new ApiError(
                401,
                'INVALID_REFRESH_TOKEN',
                'Refresh session is invalid or expired'
            )
        }

        res.cookie(COOKIE_NAME, nextRefreshToken, {
            ...cookieOptions,
            expires: session.expiresAt
        })

        res.status(200).json({
            data: {
                accessToken,
                user: publicUser(session.user)
            }
        })
    })

    router.get('/me', requireAuth, (req, res) => {
        res.status(200).json({
            data: currentAuth(res).user
        })
    })

    router.post('/logout', async (req, res) => {
        const refreshToken: unknown = req.cookies?.[COOKIE_NAME]

        if (validRefreshToken(refreshToken)) {
            await db.session.deleteMany({
                where: {
                    tokenHash: hashRefreshToken(refreshToken)
                }
            })
        }

        res.clearCookie(COOKIE_NAME, cookieOptions)
        res.status(204).send()
    })

    router.post('/logout-all', requireAuth, async (req, res) => {
        const auth = currentAuth(res)

        await db.session.deleteMany({
            where: {
                userId: auth.user.id
            }
        })

        res.clearCookie(COOKIE_NAME, cookieOptions)
        res.status(204).send()
    })

    return router
}