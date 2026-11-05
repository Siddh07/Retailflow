import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        fileParallelism: false,
        hookTimeout: 15000,
        testTimeout: 15000,
        exclude: ['**/node_modules/**', '**/dist/**']
    }
})
