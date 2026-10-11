import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { createLogger } from './logger';

const logger = createLogger('proxy');

export function setupGlobalProxy() {
    const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY;
    const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY;
    const allProxy = process.env.all_proxy || process.env.ALL_PROXY;

    // Logic: Specific proxy > All proxy > None
    const targetHttpProxy = httpProxy || allProxy;
    const targetHttpsProxy = httpsProxy || allProxy;

    if (targetHttpProxy || targetHttpsProxy) {
        if (process.env.NODE_ENV === 'development') {
            logger.info({ http: targetHttpProxy, https: targetHttpsProxy }, 'Configuring proxy');
        }

        // 1. Configure Undici (global fetch)
        // 用 EnvHttpProxyAgent 而非裸 ProxyAgent：前者尊重 NO_PROXY 环境变量，
        // 让 localhost / 127.0.0.1 等本地请求直连、不走代理。
        // 否则 dev server 内部对自己的 chunk 请求也会被塞进代理，
        // 代理处理不了 localhost 就挂住，浏览器永远等不到 JS（一直转圈）。
        const undiciProxy = targetHttpsProxy || targetHttpProxy;
        if (undiciProxy) {
            try {
                // EnvHttpProxyAgent 自动读 HTTP_PROXY/HTTPS_PROXY/NO_PROXY
                const proxyAgent = new EnvHttpProxyAgent();
                setGlobalDispatcher(proxyAgent);
                if (process.env.NODE_ENV === 'development') {
                    logger.info({ proxy: undiciProxy }, 'Global Undici dispatcher set (EnvHttpProxyAgent, respects NO_PROXY)');
                }
            } catch (error) {
                logger.error({ error }, 'Failed to set global Undici dispatcher');
            }
        }

        // 2. Configure legacy http/https modules using global-agent
        try {
            // We set the environment variables that global-agent looks for
            if (targetHttpProxy) process.env.GLOBAL_AGENT_HTTP_PROXY = targetHttpProxy;
            if (targetHttpsProxy) process.env.GLOBAL_AGENT_HTTPS_PROXY = targetHttpsProxy;

            // Also set the global config object which global-agent uses
            // @ts-ignore
            global.GLOBAL_AGENT = {
                HTTP_PROXY: targetHttpProxy,
                HTTPS_PROXY: targetHttpsProxy,
            };

            // Import bootstrap to patch http/https
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('global-agent/bootstrap');

            if (process.env.NODE_ENV === 'development') {
                logger.info('global-agent/bootstrap initialized');
            }
        } catch (error) {
            logger.error({ error }, 'Failed to initialize global-agent');
        }
    }
}
