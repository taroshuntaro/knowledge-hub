import { describe, expect, it } from 'vitest';
import { createCommentSchema, updateCommentSchema, reactionSchema } from './comment';

describe('comment schemas', () => {
  it('createCommentSchema: bodyMd のみで通り parentId は任意', () => {
    const r = createCommentSchema.safeParse({ bodyMd: 'hello' });
    expect(r.success).toBe(true);
  });

  it('createCommentSchema: 空文字 bodyMd は不可', () => {
    const r = createCommentSchema.safeParse({ bodyMd: '' });
    expect(r.success).toBe(false);
  });

  it('createCommentSchema: bodyMd 5001 文字は不可', () => {
    const r = createCommentSchema.safeParse({ bodyMd: 'a'.repeat(5001) });
    expect(r.success).toBe(false);
  });

  it('createCommentSchema: parentId が非 UUID なら不可', () => {
    const r = createCommentSchema.safeParse({ bodyMd: 'hello', parentId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('updateCommentSchema: bodyMd 必須', () => {
    expect(updateCommentSchema.safeParse({ bodyMd: '' }).success).toBe(false);
    expect(updateCommentSchema.safeParse({ bodyMd: '更新後' }).success).toBe(true);
  });

  it('reactionSchema: プリセット絵文字を通す', () => {
    const r = reactionSchema.safeParse({ emoji: '👍' });
    expect(r.success).toBe(true);
  });

  it('reactionSchema: プリセット外の絵文字は不可', () => {
    const r = reactionSchema.safeParse({ emoji: '💩' });
    expect(r.success).toBe(false);
  });
});
