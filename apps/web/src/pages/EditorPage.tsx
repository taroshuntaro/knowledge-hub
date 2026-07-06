import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { CategorySelect } from '../components/CategorySelect';
import { TagInput } from '../components/TagInput';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { RichEditor } from '@/components/editor/RichEditor';
import { isLossless, roundTrip } from '@/lib/editor/markdown-bridge';

type EditorMode = 'rich' | 'source';

/**
 * ソース → リッチ切替時のガード。無損失なら素通り、そうでなければ
 * 変換後の Markdown を添えて呼び出し側に判断（変換して続行 / キャンセル）を委ねる。
 */
export function canEnterRich(bodyMd: string): { ok: true } | { ok: false; converted: string } {
  if (isLossless(bodyMd)) return { ok: true };
  return { ok: false, converted: roundTrip(bodyMd) };
}

export function EditorPage() {
  const { id: routeId } = useParams();
  const [id, setId] = useState<string | null>(routeId ?? null);
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // 新規記事はリッチが初期値。既存記事は読み込み完了までソースを暫定表示し、
  // 読み込んだ bodyMd の isLossless 判定でリッチ/ソースを確定する。
  const [mode, setMode] = useState<EditorMode>(routeId ? 'source' : 'rich');
  const [richKey, setRichKey] = useState(0);
  const [richGuard, setRichGuard] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const theme = useTheme();

  // 既存記事の読み込み
  useEffect(() => {
    if (!routeId) return;
    (async () => {
      const res = await api.api.articles[':id'].$get({ param: { id: routeId } });
      if (!res.ok) { setLoadFailed(true); return; }
      const a = await res.json();
      setTitle(a.title); setBodyMd(a.bodyMd); setCategoryId(a.categoryId); setTags(a.tags); setUpdatedAt(a.updatedAt);
      if (isLossless(a.bodyMd)) {
        setMode('rich');
      } else {
        setMode('source');
        setStatus('この記事の Markdown はリッチ表示に完全対応していないため、Markdown モードで開きました');
      }
    })();
  }, [routeId]);

  function handleClickRich() {
    const guard = canEnterRich(bodyMd);
    if (guard.ok) {
      setRichKey((k) => k + 1);
      setMode('rich');
    } else {
      setRichGuard(guard.converted);
    }
  }

  function handleConvertAndEnterRich() {
    if (richGuard === null) return;
    setBodyMd(richGuard);
    setRichGuard(null);
    setRichKey((k) => k + 1);
    setMode('rich');
  }

  function handleClickSource() {
    setRichGuard(null);
    setMode('source');
  }

  // 保存し、成功時は対象記事の id を返す（失敗・タイトル空は null）
  async function save(): Promise<string | null> {
    setError(null);
    if (!title.trim()) return null;
    if (id && updatedAt) {
      const res = await api.api.articles[':id'].$patch({
        param: { id }, json: { title, bodyMd, categoryId, tags, expectedUpdatedAt: updatedAt },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(b?.message ?? '保存に失敗しました');
        return null;
      }
      const a = await res.json();
      setUpdatedAt(a.updatedAt); setStatus('保存しました');
      return id;
    } else {
      const res = await api.api.articles.$post({ json: { title, bodyMd, categoryId, tags } });
      if (!res.ok) { setError('保存に失敗しました'); return null; }
      const a = await res.json();
      setId(a.id); setUpdatedAt(a.updatedAt); setStatus('保存しました');
      return a.id;
    }
  }

  // 自動保存（2 秒デバウンス。title が空の間は保存しない）
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!title.trim()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, bodyMd, categoryId, tags]);

  async function publish() {
    const target = id ?? (await save());
    if (!target) return;
    const res = await api.api.articles[':id'].publish.$post({ param: { id: target } });
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(b?.message ?? '公開に失敗しました');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['feed'] });
    navigate(`/articles/${target}`);
  }

  if (loadFailed) {
    return <p role="alert" className="text-destructive">記事の読み込みに失敗しました。</p>;
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="editor-title">タイトル</Label>
        <Input id="editor-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="editor-category">カテゴリ</Label>
        <CategorySelect id="editor-category" value={categoryId} onChange={setCategoryId} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="editor-tags">タグ</Label>
        <TagInput id="editor-tags" value={tags} onChange={setTags} />
      </div>
      <nav className="inline-flex rounded-lg bg-muted p-1" aria-label="編集モード">
        <button
          type="button"
          aria-pressed={mode === 'rich'}
          onClick={handleClickRich}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          リッチ
        </button>
        <button
          type="button"
          aria-pressed={mode === 'source'}
          onClick={handleClickSource}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          Markdown
        </button>
      </nav>
      {richGuard !== null && (
        <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <p>この Markdown はリッチ編集で完全に再現できない可能性があります。変換して続行しますか？</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={handleConvertAndEnterRich}>変換して続行</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setRichGuard(null)}>キャンセル</Button>
          </div>
        </div>
      )}
      {mode === 'rich' ? (
        <RichEditor key={richKey} initialMarkdown={bodyMd} onChangeMarkdown={setBodyMd} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <CodeMirror value={bodyMd} height="480px" theme={theme} extensions={[markdown()]} onChange={setBodyMd} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={save}>下書き保存</Button>
        <Button type="button" onClick={publish}>公開する</Button>
      </div>
    </section>
  );
}
