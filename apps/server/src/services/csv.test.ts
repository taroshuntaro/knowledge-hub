import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('基本のカンマ区切りと LF/CRLF を解釈する', () => {
    expect(parseCsv('a,b,c\n1,2,3\r\n4,5,6')).toEqual([
      ['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6'],
    ]);
  });

  it('クォート内のカンマ・改行・"" エスケープを解釈する', () => {
    expect(parseCsv('a,"b,1","c\n2"\n"say ""hi""",x,y')).toEqual([
      ['a', 'b,1', 'c\n2'], ['say "hi"', 'x', 'y'],
    ]);
  });

  it('BOM・末尾改行・空行を無視する', () => {
    expect(parseCsv('\ufeffa,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('空文字列は空配列', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
