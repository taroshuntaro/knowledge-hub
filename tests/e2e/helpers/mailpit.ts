const MAILPIT = 'http://localhost:58025';

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
}

type MessageSummary = { ID: string; To: { Address: string }[] };

/** 宛先に一致する最新メールの本文テキストを返す（受信までポーリング） */
export async function latestMessageText(to: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/messages`);
    const body = (await res.json()) as { messages: MessageSummary[] };
    const hit = body.messages.find((m) => m.To.some((t) => t.Address === to));
    if (hit) {
      const detail = await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`);
      const msg = (await detail.json()) as { Text: string };
      return msg.Text;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`mail to ${to} not received within ${timeoutMs}ms`);
}
