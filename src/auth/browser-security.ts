import type { RequestHandler } from 'express'
import { ApiError } from '../errors/api-error.js'
import type { AuthConfig } from './config.js'

export function browserSecurity(
    config: AuthConfig
): RequestHandler {
    return (req, res, next) => {
        const origin = req.get('Origin')

        if (origin && origin !== config.appOrigin) {
            throw new ApiError(
                403,
                'ORIGIN_NOT_ALLOWED',
                'Request origin is not allowed'
            )
        }

        const changesState = !['GET', 'HEAD', 'OPTIONS'].includes(
            req.method
        )

        if (
            changesState &&
            req.get('X-CSRF-Protection') !== '1'
        ) {
            throw new ApiError(
                403,
                'CSRF_HEADER_REQUIRED',
                'X-CSRF-Protection header is required'
            )
        }

        next()
    }
}