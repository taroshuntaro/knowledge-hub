import { describe, expect, it } from 'vitest';
import { extractMentionedUserIds } from './mention';

const U1 = '47395b74-5d75-487d-9ee6-481eb4c32ebc';
const U2 = '11111111-2222-4333-8444-555555555555';

describe('extractMentionedUserIds', () => {
  it('リンク記法のメンションから UUID を抽出する', () => {
    expect(extractMentionedUserIds(`お疲れさまです [@田中](/users/${U1}) さん`)).toEqual([U1]);
  });

  it('複数メンションを順に返し、同一ユーザーは重複排除する', () => {
    const body = `[@田中](/users/${U1}) と [@佐藤](/users/${U2})、再度 [@田中](/users/${U1})`;
    expect(extractMentionedUserIds(body)).toEqual([U1, U2]);
  });

  it('大文字 UUID は小文字に正規化する', () => {
    expect(extractMentionedUserIds(`[@X](/users/${U1.toUpperCase()})`)).toEqual([U1]);
  });

  it('コードフェンス内・インラインコード内のメンションは無視する', () => {
    const body = '```\n[@a](/users/' + U1 + ')\n```\nと `[@b](/users/' + U2 + ')` はコード';
    expect(extractMentionedUserIds(body)).toEqual([]);
  });

  it('UUID 形式でないリンク・@ なしのユーザーリンクは無視する', () => {
    expect(extractMentionedUserIds('[@x](/users/not-a-uuid) [田中](/users/' + U1 + ')')).toEqual([]);
  });

  it('メンションのない本文は空配列', () => {
    expect(extractMentionedUserIds('通常の [リンク](https://example.com) だけ')).toEqual([]);
  });
});
