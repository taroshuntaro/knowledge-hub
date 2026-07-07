import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Textarea } from '@/components/ui/textarea';

type Candidate = { id: string; displayName: string; avatarUrl: string | null };

/** caret 直前の `@クエリ` トークンを探す（行頭または空白直後の @ のみ対象） */
function findMentionToken(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

export function MentionTextarea({
  value,
  onChange,
  'aria-label': ariaLabel,
  rows,
  maxLength,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [token, setToken] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const { data: candidates } = useQuery({
    queryKey: ['mention-candidates'],
    queryFn: async () => {
      const res = await api.api.users.$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: token !== null,
  });

  const matches = useMemo(() => {
    if (!token || !candidates) return [];
    return (candidates as Candidate[])
      .filter((c) => c.displayName.toLowerCase().includes(token.query.toLowerCase()))
      .slice(0, 5);
  }, [token, candidates]);

  function syncToken() {
    const el = ref.current;
    if (!el) return;
    setToken(findMentionToken(el.value, el.selectionStart));
    setActive(0);
  }

  function insertMention(c: Candidate) {
    const el = ref.current;
    if (!el || !token) return;
    const caret = el.selectionStart;
    const label = c.displayName.replace(/[\[\]\r\n]/g, '');
    const inserted = `[@${label}](/users/${c.id}) `;
    onChange(value.slice(0, token.start) + inserted + value.slice(caret));
    setToken(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = token.start + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const suppressNextSync = useRef(false);

  function onKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suppressNextSync.current) {
      suppressNextSync.current = false;
      return;
    }
    syncToken();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!token) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      suppressNextSync.current = true;
      setToken(null);
      return;
    }
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suppressNextSync.current = true;
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suppressNextSync.current = true;
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      suppressNextSync.current = true;
      insertMention(matches[active]);
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        aria-label={ariaLabel}
        value={value}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          syncToken();
        }}
        onKeyUp={onKeyUp}
        onClick={syncToken}
        onKeyDown={onKeyDown}
      />
      {token && matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="メンション候補"
          className="absolute z-10 mt-1 w-full max-w-xs rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(c);
              }}
            >
              <button
                type="button"
                tabIndex={-1}
                className={`w-full rounded-sm px-2 py-1.5 text-left text-sm ${i === active ? 'bg-accent text-accent-foreground' : ''}`}
              >
                {c.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
