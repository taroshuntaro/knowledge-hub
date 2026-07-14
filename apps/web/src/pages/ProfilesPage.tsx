import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useProfiles, type ProfileItem, type ProfileMaster } from '../api/profiles';
import { Avatar } from '../components/Avatar';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SortKey = 'name' | 'department' | 'position' | 'hireYearAsc' | 'hireYearDesc';

const collator = new Intl.Collator('ja');

// マスタ sortOrder 順 → 同順位は名前順。未設定（null）は末尾。
function byMaster(orderOf: Map<string, number>, pick: (u: ProfileItem) => { id: string } | null) {
  return (a: ProfileItem, b: ProfileItem) => {
    const oa = pick(a) ? orderOf.get(pick(a)!.id)! : Number.POSITIVE_INFINITY;
    const ob = pick(b) ? orderOf.get(pick(b)!.id)! : Number.POSITIVE_INFINITY;
    return oa - ob || collator.compare(a.displayName, b.displayName);
  };
}

function byHireYear(dir: 1 | -1) {
  return (a: ProfileItem, b: ProfileItem) => {
    // null（未設定）は昇順・降順とも末尾に置く
    if (a.hireYear === null && b.hireYear === null) return collator.compare(a.displayName, b.displayName);
    if (a.hireYear === null) return 1;
    if (b.hireYear === null) return -1;
    return (a.hireYear - b.hireYear) * dir || collator.compare(a.displayName, b.displayName);
  };
}

function orderMap(masters: ProfileMaster[]): Map<string, number> {
  return new Map(masters.map((m, i) => [m.id, i]));
}

export function ProfilesPage() {
  const { data, isLoading, isError } = useProfiles();
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [hireYear, setHireYear] = useState('');
  const [sort, setSort] = useState<SortKey>('name');

  const users = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    const filtered = data.users.filter((u) =>
      (query === '' || u.displayName.toLowerCase().includes(query)) &&
      (departmentId === '' || u.department?.id === departmentId) &&
      (positionId === '' || u.position?.id === positionId) &&
      (hireYear === '' || u.hireYear === Number(hireYear)),
    );
    const comparators: Record<SortKey, (a: ProfileItem, b: ProfileItem) => number> = {
      name: (a, b) => collator.compare(a.displayName, b.displayName),
      department: byMaster(orderMap(data.departments), (u) => u.department),
      position: byMaster(orderMap(data.positions), (u) => u.position),
      hireYearAsc: byHireYear(1),
      hireYearDesc: byHireYear(-1),
    };
    return [...filtered].sort(comparators[sort]);
  }, [data, q, departmentId, positionId, hireYear, sort]);

  const hireYears = useMemo(() => {
    const years = new Set<number>();
    for (const u of data?.users ?? []) if (u.hireYear !== null) years.add(u.hireYear);
    return [...years].sort((a, b) => b - a);
  }, [data]);

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState />;

  const selectClass =
    'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">メンバー</h2>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="member-search">名前で検索</Label>
          <Input
            id="member-search" type="search" value={q}
            onChange={(e) => setQ(e.target.value)} placeholder="表示名"
            className="w-48"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-department">所属</Label>
          <select id="filter-department" className={selectClass} value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">すべて</option>
            {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-position">役職</Label>
          <select id="filter-position" className={selectClass} value={positionId}
            onChange={(e) => setPositionId(e.target.value)}>
            <option value="">すべて</option>
            {data.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-hire-year">入社年</Label>
          <select id="filter-hire-year" className={selectClass} value={hireYear}
            onChange={(e) => setHireYear(e.target.value)}>
            <option value="">すべて</option>
            {hireYears.map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sort-key">並び替え</Label>
          <select id="sort-key" className={selectClass} value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="name">名前順</option>
            <option value="department">所属順</option>
            <option value="position">役職順</option>
            <option value="hireYearAsc">入社年が古い順</option>
            <option value="hireYearDesc">入社年が新しい順</option>
          </select>
        </div>
        <p className="ml-auto text-sm text-muted-foreground">{users.length} 人</p>
      </div>

      {users.length === 0 ? (
        <p className="text-muted-foreground">該当するメンバーがいません。</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {users.map((u) => (
            <li key={u.id}>
              <Link to={`/users/${u.id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-start gap-3 pt-4">
                    <Avatar src={u.avatarUrl} name={u.displayName} className="size-10" />
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{u.displayName}</h3>
                      <p className="text-sm text-muted-foreground">
                        {[u.department?.name, u.position?.name].filter(Boolean).join(' / ') || '所属・役職 未設定'}
                        {u.hireYear !== null && ` ・ ${u.hireYear} 年入社`}
                      </p>
                      {u.bio && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{u.bio}</p>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
