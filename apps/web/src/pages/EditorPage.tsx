import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { CategorySelect } from '../components/CategorySelect';
import { TagInput } from '../components/TagInput';

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // 既存記事の読み込み
  useEffect(() => {
    if (!routeId) return;
    (async () => {
      const res = await api.api.articles[':id'].$get({ param: { id: routeId } });
      if (!res.ok) return;
      const a = await res.json();
      setTitle(a.title); setBodyMd(a.bodyMd); setCategoryId(a.categoryId); setTags(a.tags); setUpdatedAt(a.updatedAt);
    })();
  }, [routeId]);

  async function save() {
    setError(null);
    if (id && updatedAt) {
      const res = await api.api.articles[':id'].$patch({
        param: { id }, json: { title, bodyMd, categoryId, tags, expectedUpdatedAt: updatedAt },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(b?.message ?? '保存に失敗しました');
        return;
      }
      const a = await res.json();
      setUpdatedAt(a.updatedAt); setStatus('保存しました');
    } else {
      const res = await api.api.articles.$post({ json: { title, bodyMd, categoryId, tags } });
      if (!res.ok) { setError('保存に失敗しました'); return; }
      const a = await res.json();
      setId(a.id); setUpdatedAt(a.updatedAt); setStatus('保存しました');
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
    if (!id) { await save(); }
    const target = id;
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

  return (
    <section className="editor">
      <label>タイトル<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>カテゴリ<CategorySelect value={categoryId} onChange={setCategoryId} /></label>
      <label>タグ<TagInput value={tags} onChange={setTags} /></label>
      <CodeMirror value={bodyMd} height="400px" extensions={[markdown()]} onChange={setBodyMd} />
      {error && <p role="alert" className="form-error">{error}</p>}
      {status && <p role="status">{status}</p>}
      <div className="editor-actions">
        <button type="button" onClick={save}>下書き保存</button>
        <button type="button" onClick={publish}>公開する</button>
      </div>
    </section>
  );
}
