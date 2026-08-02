import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys } from '../../api/keys';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NETWORK_ERROR_MESSAGE } from '../../lib/api-error';

type ImportError = { line: number; email?: string; message: string };
type ImportResult =
  | { ok: true; message: string }
  | { ok: false; message: string; details: ImportError[] };

/**
 * 1 つの CSV インポートフォーム。既存の所属/役職/入社年一括設定（AdminUsersPage）と
 * 同じ「file 選択 → インポート → 成功サマリ or 行番号付きエラー」の構造を踏襲する。
 */
function CsvImportCard({
  id, title, description, buttonLabel, submit,
}: {
  id: string;
  title: string;
  description: string;
  buttonLabel: string;
  submit: (file: File) => Promise<ImportResult>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setErrors([]);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage('CSV ファイルを選択してください');
      return;
    }
    try {
      const result = await submit(file);
      setMessage(result.message);
      if (result.ok) {
        if (fileRef.current) fileRef.current.value = '';
      } else {
        setErrors(result.details);
      }
    } catch {
      setMessage(NETWORK_ERROR_MESSAGE);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <h3 className="leading-none font-semibold">{title}</h3>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">{description}</p>
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor={id}>{title.includes('登録') ? '登録' : '無効化'} CSV ファイル</Label>
            <Input id={id} type="file" accept=".csv,text/csv" ref={fileRef} />
          </div>
          <Button type="submit">{buttonLabel}</Button>
        </form>
        {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
        {errors.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-destructive">
            {errors.map((e, i) => (
              <li key={i}>{e.line} 行目{e.email ? `（${e.email}）` : ''}: {e.message}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function extractError(body: unknown, fallback: string): { message: string; details: ImportError[] } {
  const b = body as { message?: string; details?: ImportError[] };
  return { message: b?.message ?? fallback, details: Array.isArray(b?.details) ? b.details : [] };
}

export function UserCsvImports() {
  const queryClient = useQueryClient();

  async function submitRegistrations(file: File): Promise<ImportResult> {
    const res = await api.api.admin.users.registrations.import.$post({ form: { file } });
    const body = await res.json();
    if (res.ok && 'created' in body) {
      const createdMasters = [...(body.createdDepartments ?? []), ...(body.createdPositions ?? [])];
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      queryClient.invalidateQueries({ queryKey: keys.adminDepartments });
      queryClient.invalidateQueries({ queryKey: keys.adminPositions });
      return {
        ok: true,
        message: `${body.created} 人を登録しました。` +
          (createdMasters.length > 0 ? `新規マスタ: ${createdMasters.join('、')}` : ''),
      };
    }
    const { message, details } = extractError(body, 'インポートに失敗しました');
    return { ok: false, message, details };
  }

  async function submitDeactivations(file: File): Promise<ImportResult> {
    const res = await api.api.admin.users.deactivate.import.$post({ form: { file } });
    const body = await res.json();
    if (res.ok && 'deactivated' in body) {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      return { ok: true, message: `${body.deactivated} 人を無効化しました。` };
    }
    const { message, details } = extractError(body, 'インポートに失敗しました');
    return { ok: false, message, details };
  }

  return (
    <>
      <CsvImportCard
        id="import-registrations-file"
        title="ユーザー登録 CSV"
        description="ヘッダー行 email,display_name,department,position,hire_year の UTF-8 CSV。未ログイン状態で一括登録します。未知の所属・役職は自動登録。エラーが1行でもあると何も登録されません。"
        buttonLabel="登録 CSV をインポート"
        submit={submitRegistrations}
      />
      <CsvImportCard
        id="import-deactivations-file"
        title="ユーザー無効化 CSV"
        description="ヘッダー行 email のみの UTF-8 CSV。該当するユーザーを一括で無効化します。エラーが1行でもあると何も無効化されません。"
        buttonLabel="無効化 CSV をインポート"
        submit={submitDeactivations}
      />
    </>
  );
}
