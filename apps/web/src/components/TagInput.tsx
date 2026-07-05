import { useState } from 'react';

export function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  function add() {
    const t = text.trim();
    if (t && !value.includes(t) && value.length < 10) onChange([...value, t]);
    setText('');
  }
  return (
    <div className="tag-input">
      <div className="tag-chips">
        {value.map((t) => (
          <span key={t} className="chip">
            {t}
            <button type="button" aria-label={`${t} を削除`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button>
          </span>
        ))}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        placeholder="タグを入力して Enter"
      />
    </div>
  );
}
