import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys } from '../../api/keys';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NETWORK_ERROR_MESSAGE, importErrorBody, type ImportRowError } from '../../lib/api-error';

export type ImportResult =
  | { ok: true; message: string }
  | { ok: false; message: string; details: ImportRowError[] };

/**
 * 1 つの CSV インポートフォーム（file 選択 → インポート → 成功サマリ or 行番号付きエラー）。
 * このページの 3 つの CSV フォーム（登録 / 無効化 / 所属・役職・入社年）で共有する。
 */
export function CsvImportCard({
  id, title, description, fileLabel, buttonLabel, submit,
}: {
  id: string;
  title: string;
  description: string;
  fileLabel: string;
  buttonLabel: string;
  submit: (file: File) => Promise<ImportResult>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<ImportRowError[]>([]);

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
            <Label htmlFor={id}>{fileLabel}</Label>
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

/** 成功サマリ末尾の「新規マスタ: …」表記（登録 CSV と所属 CSV で共通）。 */
export function createdMastersSuffix(body: {
  createdDepartments?: string[];
  createdPositions?: string[];
}): string {
  const created = [...(body.createdDepartments ?? []), ...(body.createdPositions ?? [])];
  return created.length > 0 ? `新規マスタ: ${created.join('、')}` : '';
}

export function UserCsvImports() {
  const queryClient = useQueryClient();

  async function submitRegistrations(file: File): Promise<ImportResult> {
    const res = await api.api.admin.users.registrations.import.$post({ form: { file } });
    const body = await res.json();
    if (res.ok && 'created' in body) {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      queryClient.invalidateQueries({ queryKey: keys.adminDepartments });
      queryClient.invalidateQueries({ queryKey: keys.adminPositions });
      return { ok: true, message: `${body.created} 人を登録しました。${createdMastersSuffix(body)}` };
    }
    const { message, details } = importErrorBody(body, 'インポートに失敗しました');
    return { ok: false, message, details };
  }

  async function submitDeactivations(file: File): Promise<ImportResult> {
    const res = await api.api.admin.users.deactivate.import.$post({ form: { file } });
    const body = await res.json();
    if (res.ok && 'deactivated' in body) {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      queryClient.invalidateQueries({ queryKey: keys.profiles });
      return { ok: true, message: `${body.deactivated} 人を無効化しました。` };
    }
    const { message, details } = importErrorBody(body, 'インポートに失敗しました');
    return { ok: false, message, details };
  }

  return (
    <>
      <CsvImportCard
        id="import-registrations-file"
        title="ユーザー登録 CSV"
        description="ヘッダー行 email,display_name,department,position,hire_year の UTF-8 CSV。未ログイン状態で一括登録します。未知の所属・役職は自動登録。エラーが1行でもあると何も登録されません。"
        fileLabel="登録 CSV ファイル"
        buttonLabel="登録 CSV をインポート"
        submit={submitRegistrations}
      />
      <CsvImportCard
        id="import-deactivations-file"
        title="ユーザー無効化 CSV"
        description="ヘッダー行 email のみの UTF-8 CSV。該当するユーザーを一括で無効化します。エラーが1行でもあると何も無効化されません。"
        fileLabel="無効化 CSV ファイル"
        buttonLabel="無効化 CSV をインポート"
        submit={submitDeactivations}
      />
    </>
  );
}
