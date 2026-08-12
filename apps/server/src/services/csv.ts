import { normalizeEmail } from './email';

/**
 * RFC 4180 準拠の最小 CSV パーサ。外部依存を増やさないための自前実装。
 * BOM 除去・ダブルクォート（"" エスケープ、クォート内カンマ/改行）・CRLF/LF 対応。
 * 空行（全フィールドが空白のみの 1 フィールド行）は列数に関わらず取り除く。
 * そのため 1 列 CSV では「完全に空の行」をデータ行の空欄エラーとして検出できない
 * （parseEmailCsv の email 空チェックに掛かる前に行ごと消える）点に注意。
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2; continue; }
    if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export type ImportError = { line: number; email?: string; message: string };

/**
 * email を先頭列に持つインポート CSV の共通検証（各インポートサービスの入口）。
 * - ヘッダー完全一致・列数・email の空/CSV 内重複を検証し、行番号付きエラーを集める。
 * - email は normalizeEmail 済み、残りのセルは trim 済みで parseRow に渡す。
 * - parseRow は行固有の検証を行い、エラー時は error(message) を呼んで null を返す
 *   （email は自動で付与される）。1 行につき最初のエラーだけを報告する慣例。
 * - ヘッダー不正・空 CSV・データ行なしは ok:false（致命）。行エラーは rows と併存しうる
 *   （all-or-nothing の適用判断は呼び出し側が DB 照合エラーとマージした後に行うため）。
 */
export function parseEmailCsv<Row>(
  csvText: string,
  header: readonly string[],
  parseRow: (args: {
    line: number;
    email: string;
    cells: string[];
    error: (message: string) => void;
  }) => Row | null,
): { ok: true; rows: Row[]; errors: ImportError[] } | { ok: false; errors: ImportError[] } {
  const table = parseCsv(csvText);
  if (table.length === 0) {
    return { ok: false, errors: [{ line: 1, message: 'CSV が空です' }] };
  }
  if (table[0].map((h) => h.trim()).join(',') !== header.join(',')) {
    return {
      ok: false,
      errors: [{ line: 1, message: `ヘッダー行は ${header.join(',')} にしてください` }],
    };
  }

  const errors: ImportError[] = [];
  const rows: Row[] = [];
  const seenEmails = new Set<string>();
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cells = table[i];
    if (cells.length !== header.length) {
      errors.push({ line, message: `列数が不正です（${header.length} 列必要）` });
      continue;
    }
    const [emailRaw, ...rest] = cells.map((v) => v.trim());
    if (!emailRaw) {
      errors.push({ line, message: 'email が空です' });
      continue;
    }
    const email = normalizeEmail(emailRaw);
    if (seenEmails.has(email)) {
      errors.push({ line, email, message: '同じ email の行が重複しています' });
      continue;
    }
    seenEmails.add(email);
    const row = parseRow({
      line, email, cells: rest,
      error: (message) => errors.push({ line, email, message }),
    });
    if (row !== null) rows.push(row);
  }

  if (rows.length === 0 && errors.length === 0) {
    return { ok: false, errors: [{ line: 1, message: 'データ行がありません' }] };
  }
  return { ok: true, rows, errors };
}
