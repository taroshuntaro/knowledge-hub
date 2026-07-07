export function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export const ADMIN = { email: 'admin@example.com', password: 'change-me-please-12', name: '管理者' };
export const MEMBER = { email: 'e2e-member@example.com', password: 'e2e-member-pass-12', name: 'E2E メンバー' };

// 1x1 の赤 PNG（アップロードの magic-byte 検証を通る実 PNG）
export const pngPixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
