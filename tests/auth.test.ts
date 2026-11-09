import { randomBytes } from 'node:crypto'
import { config } from 'dotenv'
import { SignJWT } from 'jose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { loadAuthConfig, type AuthConfig } from '../src/auth/config.js'
import { hashPassword } from '../src/auth/password.js'

config({ path: '.env.test', override: true })

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
    throw new Error('Test DATABASE_URL is missing')
}

const url = new URL(connectionString)
if (
    url.hostname !== 'localhost' ||
    url.pathname !== '/retailflow_test'
) {
    throw new Error('Expected local retailflow_test database')
}

const db = createDatabaseClient(connectionString)

let authConfig: AuthConfig
let passwordHash: string
let app: ReturnType<typeof createApp>
const password = 'A long authentication test passphrase'

beforeAll(async () => {
    await db.$connect()

    const rows = await db.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name
    `

    if (rows[0]?.name !== 'retailflow_test') {
        throw new Error('Refusing to reset a non-test database')
    }

    authConfig = await loadAuthConfig({
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://localhost:5173',
        JWT_SECRET_BASE64: randomBytes(32).toString('base64')
    })
    passwordHash = await hashPassword(password)
})

beforeEach(async () => {
    await db.$transaction([
        db.session.deleteMany(),
        db.orderItem.deleteMany(),
        db.order.deleteMany(),
        db.customer.deleteMany(),
        db.user.deleteMany(),
        db.product.deleteMany()
    ])

    await db.user.createMany({
        data: [
            {
                email: 'admin@example.com',
                passwordHash,
                role: 'ADMIN'
            },
            {
                email: 'cashier@example.com',
                passwordHash,
                role: 'CASHIER'
            }
        ]
    })

    app = createApp(db, authConfig)
})

afterAll(async () => {
    await db.$disconnect()
})

async function login(email = 'admin@example.com') {
    return request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Protection', '1')
        .send({ email, password })
        .expect(200)
}

function responseCookie(response: { headers: Record<string, unknown> }) {
    const cookies = response.headers['set-cookie']
    const first = Array.isArray(cookies) ? cookies[0] : cookies
    if (typeof first !== 'string') {
        throw new Error('Expected a refresh cookie')
    }
    return first.split(';')[0]
}

describe('Authentication and permissions', () => {
    it('requires authentication to read products', async () => {
        await request(app)
            .get('/api/v1/products')
            .expect(401)
    })

    it('returns safe user data and an HttpOnly cookie', async () => {
        const response = await login()
        expect(response.body.data.accessToken).toEqual(expect.any(String))
        expect(response.body.data.user).not.toHaveProperty('passwordHash')

        const cookies = response.headers['set-cookie']
        expect(String(cookies)).toContain('HttpOnly')
        expect(String(cookies)).toContain('SameSite=Strict')

        const sessions = await db.session.findMany()
        expect(sessions).toHaveLength(1)
        expect(sessions[0].tokenHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('uses the same error for unknown email and wrong password', async () => {
        const unknown = await request(app)
            .post('/api/v1/auth/login')
            .set('X-CSRF-Protection', '1')
            .send({ email: 'missing@example.com', password })

        const incorrect = await request(app)
            .post('/api/v1/auth/login')
            .set('X-CSRF-Protection', '1')
            .send({
                email: 'admin@example.com',
                password: 'An incorrect long passphrase'
            })

        expect(unknown.status).toBe(401)
        expect(incorrect.status).toBe(401)
        expect(unknown.body).toEqual(incorrect.body)
    })

    it('allows a cashier to read but not create products', async () => {
        const response = await login('cashier@example.com')
        const token = response.body.data.accessToken

        await request(app)
            .get('/api/v1/products')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'Keyboard',
                sku: 'KEY-001',
                price: 2000,
                stockQuantity: 10
            })
            .expect(403)
    })

    it('allows admins to create employees with hashed passwords', async () => {
        const response = await login()

        await request(app)
            .post('/api/v1/users')
            .set('Authorization', `Bearer ${response.body.data.accessToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ email: 'new@example.com', password, role: 'CASHIER' })
            .expect(201)

        const user = await db.user.findUniqueOrThrow({
            where: { email: 'new@example.com' }
        })

        expect(user.passwordHash).not.toBe(password)
        expect(user.passwordHash).toMatch(/^\$argon2id\$/)
    })

    it('rejects replay of a rotated refresh token', async () => {
        const loggedIn = await login()
        const oldCookie = responseCookie(loggedIn)

        const refreshed = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', oldCookie)
            .set('X-CSRF-Protection', '1')
            .expect(200)

        expect(responseCookie(refreshed)).not.toBe(oldCookie)

        await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', oldCookie)
            .set('X-CSRF-Protection', '1')
            .expect(401)
    })

    it('allows only one concurrent refresh with the same token', async () => {
        const loggedIn = await login()
        const cookie = responseCookie(loggedIn)

        const responses = await Promise.all([
            request(app)
                .post('/api/v1/auth/refresh')
                .set('Cookie', cookie)
                .set('X-CSRF-Protection', '1'),
            request(app)
                .post('/api/v1/auth/refresh')
                .set('Cookie', cookie)
                .set('X-CSRF-Protection', '1')
        ])

        expect(responses.map((response) => response.status).sort()).toEqual([
            200,
            401
        ])
    })

    it('invalidates the access token after logout', async () => {
        const loggedIn = await login()

        await request(app)
            .post('/api/v1/auth/logout')
            .set('Cookie', responseCookie(loggedIn))
            .set('X-CSRF-Protection', '1')
            .expect(204)

        await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${loggedIn.body.data.accessToken}`)
            .expect(401)
    })

    it('rejects a disabled user’s existing access token', async () => {
        const loggedIn = await login()

        await db.user.update({
            where: { email: 'admin@example.com' },
            data: { isActive: false }
        })

        await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${loggedIn.body.data.accessToken}`)
            .expect(401)
    })

    it('rejects an expired session', async () => {
        const loggedIn = await login()

        await db.session.updateMany({
            data: { expiresAt: new Date(0) }
        })

        await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', responseCookie(loggedIn))
            .set('X-CSRF-Protection', '1')
            .expect(401)
    })

    it('rejects mutation requests without the CSRF header', async () => {
        await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'admin@example.com', password })
            .expect(403)
    })

    it('rejects an unapproved browser origin', async () => {
        await request(app)
            .post('/api/v1/auth/login')
            .set('Origin', 'https://unapproved.example')
            .set('X-CSRF-Protection', '1')
            .send({ email: 'admin@example.com', password })
            .expect(403)
    })

    it('limits repeated login attempts', async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
            await request(app)
                .post('/api/v1/auth/login')
                .set('X-CSRF-Protection', '1')
                .send({
                    email: 'admin@example.com',
                    password: 'An incorrect passphrase'
                })
                .expect(401)
        }

        await request(app)
            .post('/api/v1/auth/login')
            .set('X-CSRF-Protection', '1')
            .send({ email: 'admin@example.com', password })
            .expect(429)
    })

    // --- Section 24: Extended tests ---

    it('rejects cashier attempting to create an employee', async () => {
        const response = await login('cashier@example.com')

        await request(app)
            .post('/api/v1/users')
            .set('Authorization', `Bearer ${response.body.data.accessToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ email: 'employee2@example.com', password, role: 'CASHIER' })
            .expect(403)
    })

    it('allows admin to update a product', async () => {
        const product = await db.product.create({
            data: {
                name: 'Tablet',
                sku: 'TAB-001',
                price: 15000,
                stockQuantity: 5
            }
        })

        const response = await login()

        await request(app)
            .patch(`/api/v1/products/${product.id}`)
            .set('Authorization', `Bearer ${response.body.data.accessToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ price: 16000 })
            .expect(200)

        const updated = await db.product.findUniqueOrThrow({
            where: { id: product.id }
        })
        expect(updated.price).toBe(16000)
    })

    it('rejects cashier attempting to archive a product', async () => {
        const product = await db.product.create({
            data: {
                name: 'Printer',
                sku: 'PRN-001',
                price: 12000,
                stockQuantity: 3
            }
        })

        const response = await login('cashier@example.com')

        await request(app)
            .delete(`/api/v1/products/${product.id}`)
            .set('Authorization', `Bearer ${response.body.data.accessToken}`)
            .set('X-CSRF-Protection', '1')
            .expect(403)
    })

    it('rejects access token with an altered signature', async () => {
        const response = await login()
        const validToken = response.body.data.accessToken
        const tamperedToken = `${validToken.slice(0, -5)}abcde`

        await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${tamperedToken}`)
            .expect(401)
    })

    it('revokes admin privileges when user role changes to Cashier', async () => {
        const response = await login()
        const token = response.body.data.accessToken

        await db.user.update({
            where: { email: 'admin@example.com' },
            data: { role: 'CASHIER' }
        })

        await request(app)
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Protection', '1')
            .send({
                name: 'Laptop',
                sku: 'LAP-001',
                price: 90000,
                stockQuantity: 2
            })
            .expect(403)
    })

    it('invalidates both tokens on logout-all', async () => {
        const login1 = await login()
        const login2 = await login()

        const token1 = login1.body.data.accessToken
        const token2 = login2.body.data.accessToken

        await request(app)
            .post('/api/v1/auth/logout-all')
            .set('Authorization', `Bearer ${token1}`)
            .set('X-CSRF-Protection', '1')
            .expect(204)

        await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${token1}`)
            .expect(401)

        await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${token2}`)
            .expect(401)
    })

    it('rejects refresh when refresh cookie is missing', async () => {
        await request(app)
            .post('/api/v1/auth/refresh')
            .set('X-CSRF-Protection', '1')
            .expect(401)
    })

    it('rejects duplicate employee email creation', async () => {
        const response = await login()

        await request(app)
            .post('/api/v1/users')
            .set('Authorization', `Bearer ${response.body.data.accessToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ email: 'duplicate@example.com', password, role: 'CASHIER' })
            .expect(201)

        await request(app)
            .post('/api/v1/users')
            .set('Authorization', `Bearer ${response.body.data.accessToken}`)
            .set('X-CSRF-Protection', '1')
            .send({ email: 'duplicate@example.com', password, role: 'CASHIER' })
            .expect(409)
    })

    it('rejects login body containing extra fields like role', async () => {
        await request(app)
            .post('/api/v1/auth/login')
            .set('X-CSRF-Protection', '1')
            .send({
                email: 'admin@example.com',
                password,
                role: 'ADMIN'
            })
            .expect(400)
    })

    it('rejects an expired JWT even if session is otherwise valid', async () => {
        const response = await login()
        const user = await db.user.findUniqueOrThrow({
            where: { email: 'admin@example.com' }
        })
        const session = await db.session.findFirstOrThrow({
            where: { userId: user.id }
        })

        const expiredToken = await new SignJWT({ sid: session.id })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject(user.id)
            .setIssuer(authConfig.issuer)
            .setAudience(authConfig.audience)
            .setIssuedAt(Math.floor(Date.now() / 1000) - 1200)
            .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
            .sign(authConfig.jwtKey)

        await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${expiredToken}`)
            .expect(401)
    })
})
