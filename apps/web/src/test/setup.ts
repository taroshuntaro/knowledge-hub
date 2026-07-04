import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest は globals 無効のため testing-library の自動クリーンアップが登録されない。
// テスト間で DOM が残らないよう明示的に登録する。
afterEach(cleanup);
