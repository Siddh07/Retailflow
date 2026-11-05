import type { ErrorRequestHandler } from 'express'
import { z } from 'zod'
import { ApiError } from '../errors/api-error.js'
import { Prisma } from '../generated/prisma/client.js'

export const errorHandler: ErrorRequestHandler = (
    error,
    req,
    res,
    next
) => {
    if (res.headersSent) {
        next(error)
        return
    }

    if (error instanceof ApiError) {
        res.status(error.statusCode).json({
            error: {
                code: error.code,
                message: error.message
            }
        })
        return
    }

    if (error instanceof z.ZodError) {
        res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: error.issues[0]?.message ?? 'Validation failed'
            }
        })
        return
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            res.status(409).json({
                error: {
                    code: 'DUPLICATE_VALUE',
                    message: 'A record with this unique value already exists'
                }
            })
            return
        }

        if (error.code === 'P2025') {
            res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: 'Requested record was not found'
                }
            })
            return
        }

        if (error.code === 'P2003') {
            res.status(409).json({
                error: {
                    code: 'RELATION_CONFLICT',
                    message: 'This operation conflicts with related records'
                }
            })
            return
        }
    }

    const isInvalidJson =
        error instanceof SyntaxError &&
        'type' in error &&
        error.type === 'entity.parse.failed'

    if (isInvalidJson) {
        res.status(400).json({
            error: {
                code: 'INVALID_JSON',
                message: 'Request body must contain valid JSON'
            }
        })
        return
    }

    console.error(error)

    res.status(500).json({
        error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Something went wrong'
        }
    })
}

