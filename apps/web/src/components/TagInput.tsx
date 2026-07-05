import { useState } from 'react';
import { Input } from '@/components/ui/input';

export function TagInput({ value, onChange, id }: { value: string[]; onChange: (v: string[]) => void; id?: string }) {
  const [text, setText] = useState('');
  function add() {
    const t = text.trim();
    if (t && !value.includes(t) && value.length < 10) onChange([...value, t]);
    setText('');
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
              {t}
              <button
                type="button"
                aria-label={`${t} を削除`}
                onClick={() => onChange(value.filter((x) => x !== t))}
                className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        placeholder="タグを入力して Enter"
      />
    </div>
  );
}
