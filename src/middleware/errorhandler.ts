import type { ErrorRequestHandler } from 'express'

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