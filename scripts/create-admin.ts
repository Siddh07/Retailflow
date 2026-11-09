import { z } from 'zod'
import { createDatabaseClient } from '../src/db/client.js'
import { emailSchema, newPasswordSchema } from '../src/auth/schemas.js'
import { hashPassword } from '../src/auth/password.js'

const input = z
    .object({
        DATABASE_URL: z.string().min(1),
        BOOTSTRAP_ADMIN_EMAIL: emailSchema,
        BOOTSTRAP_ADMIN_PASSWORD: newPasswordSchema
    })
    .parse(process.env)

const url = new URL(input.DATABASE_URL)
if (
    url.hostname !== 'localhost' ||
    url.pathname !== '/retailflow_dev'
) {
    throw new Error('This bootstrap script expects local retailflow_dev')
}

const db = createDatabaseClient(input.DATABASE_URL)

async function main() {
    const existingAdmin = await db.user.findFirst({
        where: { role: 'ADMIN', isActive: true }
    })
    if (existingAdmin) {
        throw new Error('An active admin already exists')
    }

    await db.user.create({
        data: {
            email: input.BOOTSTRAP_ADMIN_EMAIL,
            passwordHash: await hashPassword(input.BOOTSTRAP_ADMIN_PASSWORD),
            role: 'ADMIN'
        }
    })

    console.log('Initial admin created')
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await db.$disconnect()
    })
