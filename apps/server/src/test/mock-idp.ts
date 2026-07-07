// テスト専用: ディスカバリ/JWKS/authorize/token を実 HTTP で提供し、
// jose で実署名した ID トークンを返す（openid-client の署名検証まで本物のパスを通すため）。
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export type MockIdp = {
  issuer: string;
  queueClaims(claims: Record<string, unknown>): void;
  authorize(authorizationUrl: string): Promise<string>; // 302 Location（callback URL）を返す
  close(): Promise<void>;
};

export async function startMockIdp(clientId: string): Promise<MockIdp> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string | null; claims: Record<string, unknown> }>();
  let queued: Record<string, unknown> = {};
  let issuer = ''; // listen 後に確定

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url!, issuer);
      const json = (body: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      }
      if (url.pathname === '/jwks') return json({ keys: [jwk] });
      if (url.pathname === '/authorize') {
        const code = randomUUID();
        codes.set(code, { nonce: url.searchParams.get('nonce'), claims: queued });
        const redirect = new URL(url.searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', url.searchParams.get('state')!);
        res.statusCode = 302;
        res.setHeader('location', redirect.href);
        return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const params = new URLSearchParams(Buffer.concat(chunks).toString());
        const entry = codes.get(params.get('code') ?? '');
        codes.delete(params.get('code') ?? '');
        if (!entry) {
          res.statusCode = 400;
          return json({ error: 'invalid_grant' });
        }
        const idToken = await new SignJWT({ ...entry.claims, ...(entry.nonce ? { nonce: entry.nonce } : {}) })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setSubject('mock-sub')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return json({ access_token: 'mock-access-token', token_type: 'bearer', id_token: idToken });
      }
      res.statusCode = 404;
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('mock idp failed to listen');
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    queueClaims(claims) {
      queued = claims;
    },
    async authorize(authorizationUrl) {
      const res = await fetch(authorizationUrl, { redirect: 'manual' });
      const location = res.headers.get('location');
      if (res.status !== 302 || !location) throw new Error(`mock authorize failed: ${res.status}`);
      return location;
    },
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
