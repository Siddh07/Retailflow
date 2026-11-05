import { config } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

config({ path: '.env.test', override: true })

const connectionString = env('DATABASE_URL')
const url = new URL(connectionString)

if (
    url.hostname !== 'localhost' ||
    url.pathname !== '/retailflow_test'
) {
    throw new Error('Expected local retailflow_test database')
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations'
    },
    datasource: {
        url: connectionString
    }
})
