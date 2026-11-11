import { z } from 'zod'

export const pageNumber = z.string().regex(/^[1-9]\d*$/).transform(Number)

export const pageQuery = z.strictObject({
    page: pageNumber.pipe(z.number().int().max(100_000)).default(1),
    limit: pageNumber.pipe(z.number().int().max(100)).default(10)
})

