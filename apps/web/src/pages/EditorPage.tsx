import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api/client';
import { CategorySelect } from '../components/CategorySelect';
import { TagInput } from '../components/TagInput';
import { HeroImageInput } from '../components/HeroImageInput';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useTheme } from '@/lib/theme';
import { RichEditor } from '@/components/editor/RichEditor';
import { isLossless, roundTrip } from '@/lib/editor/markdown-bridge';
import { Markdown } from '@/lib/markdown';
import { firstImageFile, uploadImage } from '@/lib/upload';

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
  const [heroImageUploadId, setHeroImageUploadId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [articleStatus, setArticleStatus] = useState<'draft' | 'published'>('draft');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishOpen, setPublishOpen] = useState(false);
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
      setHeroImageUploadId(a.heroImageUploadId ?? null);
      setArticleStatus(a.status ?? 'draft');
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

  // 保存し、成功時は対象記事の id/updatedAt を返す（失敗・タイトル空は null）。
  // override を渡すと、id/updatedAt の判定（PATCH か POST か、PATCH の
  // expectedUpdatedAt）にその値を使う。enqueueSave が直列化チェーンの中で、
  // 直前の保存が解決した結果をここへ明示的に渡すために使う（詳細は下記）。
  // override 省略時の挙動・API 呼び出し・エラー処理は従来の save() と同一。
  async function save(override?: { id: string; updatedAt: string }): Promise<{ id: string; updatedAt: string } | null> {
    setError(null);
    if (!title.trim()) return null;
    const currentId = override?.id ?? id;
    const currentUpdatedAt = override?.updatedAt ?? updatedAt;
    if (currentId && currentUpdatedAt) {
      const res = await api.api.articles[':id'].$patch({
        param: { id: currentId },
        json: { title, bodyMd, categoryId, heroImageUploadId, tags, expectedUpdatedAt: currentUpdatedAt },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(b?.message ?? '保存に失敗しました');
        return null;
      }
      const a = await res.json();
      setUpdatedAt(a.updatedAt); // 保存完了の表示はアクションバーの saveState に一本化
      return { id: currentId, updatedAt: a.updatedAt };
    } else {
      const res = await api.api.articles.$post({ json: { title, bodyMd, categoryId, heroImageUploadId, tags } });
      if (!res.ok) { setError('保存に失敗しました'); return null; }
      const a = await res.json();
      setId(a.id); setUpdatedAt(a.updatedAt); // 同上: バーの saveState に一本化
      return { id: a.id, updatedAt: a.updatedAt };
    }
  }

  // 保存の直列化: 前の保存が完了してから次を実行する（新規作成 POST の重複防止）。
  //
  // save は毎レンダーで新しい closure になり、その時点の title/bodyMd/categoryId/tags
  // を束縛する。実行時点で最新の入力を使えるよう saveRef 経由で間接化する。
  // 一方 id/updatedAt は closure の再レンダー待ちに依存させない。直前の保存が
  // 解決した { id, updatedAt } を Promise チェーンでそのまま次のリンクへ
  // override として渡すことで、React の state コミットタイミングに関係なく
  // 直列化した 2 回目以降の保存が新規作成 POST ではなく更新 PATCH になる
  // （setTimeout でレンダーの完了を待つ必要がない、純粋な microtask チェーン）。
  const saveRef = useRef(save);
  saveRef.current = save;
  const saveChain = useRef<Promise<{ id: string; updatedAt: string } | null>>(Promise.resolve(null));
  function enqueueSave(): Promise<string | null> {
    const next = saveChain.current.then((prev) => saveRef.current(prev ?? undefined));
    saveChain.current = next.catch(() => null);
    return next.then((result) => result?.id ?? null);
  }

  // リッチエディタの 500ms 直列化デバウンスを保存前に確定させる（データ損失レース防止）。
  // リッチモード時のみ RichEditor が current を設定する。ソースモードは即時反映のため不要。
  const richFlush = useRef<(() => void) | null>(null);

  // 保存状態インジケータ用の薄いラッパ。enqueueSave の直列化は無改変。
  async function runSave(): Promise<string | null> {
    richFlush.current?.();
    setSaveState('saving');
    try {
      const savedId = await enqueueSave();
      setSaveState(savedId ? 'saved' : 'idle');
      return savedId;
    } catch {
      setSaveState('error');
      return null;
    }
  }

  // 自動保存（2 秒デバウンス。title が空の間は保存しない）
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!title.trim()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void runSave(); }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, bodyMd, categoryId, heroImageUploadId, tags]);

  async function publish() {
    // id の有無に関わらず必ず保存をフラッシュしてから publish する。
    // （id ありをスキップすると、デバウンス発火前の直近編集が公開版に含まれず、
    //   navigate によるアンマウントで保存もされず失われる）
    // リッチエディタ側の 500ms 直列化デバウンスも先に確定させる。
    richFlush.current?.();
    let target: string | null = null;
    try {
      target = await enqueueSave();
    } catch {
      setError('保存に失敗しました');
      return;
    }
    if (!target) return;
    let res: Awaited<ReturnType<typeof api.api.articles[':id']['publish']['$post']>>;
    try {
      res = await api.api.articles[':id'].publish.$post({ param: { id: target } });
    } catch {
      setError('通信に失敗しました。時間をおいて再試行してください');
      return;
    }
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(b?.message ?? '公開に失敗しました');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['feed'] });
    navigate(`/articles/${target}`);
  }

  // ソースモード（CodeMirror）での画像 D&D / ペースト。
  // カーソル位置への挿入には EditorView の API が必要になるため、
  // v1 ではカーソル位置に関わらず本文末尾に追記する。
  async function handleSourceImageUpload(file: File) {
    try {
      const { url } = await uploadImage(file);
      setBodyMd((prev) => `${prev}\n\n![](${url})\n`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像のアップロードに失敗しました');
    }
  }

  if (loadFailed) {
    return <p role="alert" className="text-destructive">記事の読み込みに失敗しました。</p>;
  }

  const publishLabel = articleStatus === 'published' ? '更新を公開' : '公開する';
  const savingLabel =
    saveState === 'saving' ? '保存中…' :
    saveState === 'error' ? '保存に失敗' :
    saveState === 'saved' ? '保存済み' :
    updatedAt ? '保存済み' : '未保存';

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b bg-background/85 px-4 py-2.5 backdrop-blur md:-mx-6 md:px-6">
        <Link to={id ? `/articles/${id}` : '/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />戻る
        </Link>
        <Badge variant={articleStatus === 'published' ? 'default' : 'secondary'}>
          {articleStatus === 'published' ? '公開済み' : '下書き'}
        </Badge>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{savingLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={runSave}>下書き保存</Button>
          <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>{publishLabel}</Button>
        </div>
      </div>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6">
      <div className="grid gap-1.5">
        <Label htmlFor="editor-title" className="sr-only">タイトル</Label>
        <input
          id="editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タイトルを入力"
          className="w-full border-none bg-transparent text-3xl font-bold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <div className="grid gap-1.5">
        <Label>ヒーロー画像</Label>
        <HeroImageInput value={heroImageUploadId} onChange={setHeroImageUploadId} />
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
        <RichEditor
          key={richKey}
          initialMarkdown={bodyMd}
          onChangeMarkdown={setBodyMd}
          onUploadImage={uploadImage}
          onError={setError}
          flushRef={richFlush}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div
            className="overflow-hidden rounded-lg border"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const file = firstImageFile(e.dataTransfer.files);
              if (!file) return;
              e.preventDefault();
              void handleSourceImageUpload(file);
            }}
            onPaste={(e) => {
              const file = firstImageFile(e.clipboardData?.files);
              if (!file) return;
              e.preventDefault();
              void handleSourceImageUpload(file);
            }}
          >
            <CodeMirror value={bodyMd} height="480px" theme={theme} extensions={[markdown()]} onChange={setBodyMd} />
          </div>
          <div className="max-h-[480px] overflow-y-auto rounded-lg border bg-card px-4 py-3" aria-label="プレビュー">
            <Markdown source={bodyMd} />
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      </section>

      <Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            aria-label="公開設定"
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col gap-5 border-l bg-card p-6 shadow-xl focus:outline-none"
          >
            <Dialog.Title className="text-base font-bold">公開設定</Dialog.Title>
            <VisuallyHidden.Root asChild>
              <Dialog.Description>記事のカテゴリとタグを設定して公開します</Dialog.Description>
            </VisuallyHidden.Root>
            <div className="grid gap-1.5">
              <Label htmlFor="publish-category">カテゴリ<span className="ml-1 text-destructive">*必須</span></Label>
              <CategorySelect id="publish-category" value={categoryId} onChange={setCategoryId} />
              {!categoryId && <p className="text-xs text-destructive">公開にはカテゴリの選択が必要です</p>}
              {!title.trim() && <p className="text-xs text-destructive">公開にはタイトルの入力が必要です</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="publish-tags">タグ（任意）</Label>
              <TagInput id="publish-tags" value={tags} onChange={setTags} />
            </div>
            <div className="mt-auto grid gap-2">
              <Button
                type="button"
                disabled={!categoryId || !title.trim()}
                onClick={async () => { setPublishOpen(false); await publish(); }}
              >
                {publishLabel}
              </Button>
              <p className="text-center text-xs text-muted-foreground">公開すると一覧・フィードに表示されます</p>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
