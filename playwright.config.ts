import { defineConfig, devices } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT || '3000';
const isolated = process.env.PLAYWRIGHT_ISOLATED === '1';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['html', { host: '0.0.0.0' }]],
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        trace: 'on-first-retry',
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    },
    webServer: {
        command: process.env.CI ? `npm run start -- -p ${port}` : `npm run dev -- -p ${port}`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: !process.env.CI && !isolated,
        timeout: 120 * 1000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
