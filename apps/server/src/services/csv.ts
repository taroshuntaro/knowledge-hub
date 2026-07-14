/**
 * RFC 4180 準拠の最小 CSV パーサ。外部依存を増やさないための自前実装。
 * BOM 除去・ダブルクォート（"" エスケープ、クォート内カンマ/改行）・CRLF/LF 対応。
 * 空行（全フィールドが空白のみの 1 フィールド行）は取り除く。
 * 1 フィールドのみの空白行はデータと区別できず取り除かれるため、1 列 CSV には使わないこと。
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
