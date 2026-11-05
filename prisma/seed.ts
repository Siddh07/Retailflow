import 'dotenv/config'
import { createDatabaseClient } from '../src/db/client.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
    throw new Error('DATABASE_URL is required')
}

const db = createDatabaseClient(connectionString)

async function main() {
    const products = [
        {
            name: 'Keyboard',
            sku: 'KEY-001',
            price: 2000,
            stockQuantity: 10
        },
        {
            name: 'Mouse',
            sku: 'MOU-001',
            price: 1000,
            stockQuantity: 5
        }
    ]

    for (const product of products) {
        await db.product.upsert({
            where: { sku: product.sku },
            update: {},
            create: product
        })
    }

    console.log('Development products seeded')
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await db.$disconnect()
    })

