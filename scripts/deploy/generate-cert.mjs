// 用 selfsigned 生成自签证书（PEM），含 SAN，供本地 HTTPS 代理使用。
// 不手写 X.509，不依赖 openssl。
//
// selfsigned v5 API note: v5 is async-only, `days` removed in favor of `notAfterDate`.
import selfsigned from 'selfsigned';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const certDir = process.env.CERT_DIR
    ? process.env.CERT_DIR.replace(/\\\\/g, '\\')
    : resolve(cwd, 'certs');
const certFile = resolve(certDir, 'cert.pem');
const keyFile = resolve(certDir, 'key.pem');

if (existsSync(certFile) && existsSync(keyFile)) {
    console.log(`[generate-cert] 证书已存在，跳过：${certDir}`);
    process.exit(0);
}

mkdirSync(certDir, { recursive: true });

// SAN：覆盖 https://localhost 与 https://127.0.0.1
const attrs = [{ name: 'commonName', value: 'localhost' }];

// selfsigned v5: `days` removed; use `notAfterDate` instead.
const notAfter = new Date();
notAfter.setFullYear(notAfter.getFullYear() + 10);

const opts = {
    keySize: 2048,
    notAfterDate: notAfter, // 10 年
    algorithm: 'sha256',
    extensions: [
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: [
            { type: 2, value: 'localhost' },                 // DNS
            { type: 7, ip: '127.0.0.1' },                     // IP
            { type: 7, ip: '::1' },                            // IPv6
        ] },
    ],
};

// selfsigned v5: generate() is async-only.
const pems = await selfsigned.generate(attrs, opts);

writeFileSync(certFile, pems.cert, 'utf8');
writeFileSync(keyFile, pems.private, 'utf8');

console.log(`[generate-cert] 证书已生成：`);
console.log(`  cert: ${certFile}`);
console.log(`  key:  ${keyFile}`);
console.log(`[generate-cert] SAN: localhost, 127.0.0.1, ::1`);
console.log(`[generate-cert] 有效期 10 年。浏览器首次访问会提示不安全，点"高级→继续访问"。`);