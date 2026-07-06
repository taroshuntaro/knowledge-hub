import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest は globals 無効のため testing-library の自動クリーンアップが登録されない。
// テスト間で DOM が残らないよう明示的に登録する。
afterEach(cleanup);

// jsdom は ProseMirror（RichEditor）が参照する一部の Range/Document API を
// 未実装のまま呼ばせて例外を投げるため、全テスト共通で最小のスタブを当てる
// （実装コードには手を入れない）。RichEditor をマウントするテストが
// EditorPage 経由も含めて複数あるため、個別テストではなくここに置く。
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () =>
  ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
document.elementFromPoint = () => null;
