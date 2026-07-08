import { Link } from 'react-router';
import { useCategories } from '../api/categories';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';

export function CategoriesPage() {
  const { data, isLoading, isError } = useCategories();

  const categories = data ?? [];

  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">カテゴリ</h2>

      {isLoading && <Loading />}

      {isError && <p className="text-destructive">読み込みに失敗しました。</p>}

      {!isLoading && !isError && categories.length === 0 && (
        <EmptyState message="カテゴリがありません" />
      )}

      {!isLoading && !isError && categories.length > 0 && (
        <ul className="flex flex-col gap-1">
          {categories.map((c) => (
            <li key={c.id}>
              <Link to={`/categories/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
              {c.children.length > 0 && (
                <ul className="ml-5 mt-1 flex flex-col gap-1">
                  {c.children.map((child) => (
                    <li key={child.id}>
                      <Link to={`/categories/${child.id}`} className="text-sm text-muted-foreground hover:underline">{child.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
