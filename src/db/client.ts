import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

export function createDatabaseClient(connectionString: string) {
    const adapter = new PrismaPg({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 5000
    })

    return new PrismaClient({ adapter })
}

