import 'dotenv/config'
import { createApp } from './app.js'
import { createDatabaseClient } from './db/client.js'
import { loadAuthConfig } from './auth/config.js'

const port = Number(process.env.PORT ?? '3000')
const connectionString = process.env.DATABASE_URL

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
}

if (!connectionString) {
    throw new Error('DATABASE_URL is required')
}

const db = createDatabaseClient(connectionString)

async function start() {
    await db.$connect()
    const authConfig = await loadAuthConfig()
    const app = createApp(db, authConfig)
    const server = app.listen(port, () => {
        console.log(`RetailFlow API: http://localhost:${port}`)
    })

    let stopping = false

    function shutdown() {
        if (stopping) return
        stopping = true

        server.close(() => {
            void db.$disconnect().catch((error) => {
                console.error(error)
                process.exitCode = 1
            })
        })
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
}

start().catch(async (error) => {
    console.error(error)
    await db.$disconnect()
    process.exitCode = 1
})
