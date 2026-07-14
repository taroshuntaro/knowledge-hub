import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { errorMessage } from '../lib/api-error';
import { keys } from './keys';
import type { ProfileMaster } from './profiles';

export type MasterKind = 'departments' | 'positions';

const routes = {
  departments: api.api.admin.departments,
  positions: api.api.admin.positions,
} as const;

const keyOf = (kind: MasterKind) =>
  kind === 'departments' ? keys.adminDepartments : keys.adminPositions;

export function useMasters(kind: MasterKind) {
  return useQuery({
    queryKey: keyOf(kind),
    queryFn: async (): Promise<ProfileMaster[]> => {
      const res = await routes[kind].$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as ProfileMaster[];
    },
  });
}

export function useMasterMutations(kind: MasterKind) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keyOf(kind) });
    queryClient.invalidateQueries({ queryKey: keys.profiles });
    queryClient.invalidateQueries({ queryKey: keys.adminUsers });
  };
  const create = useMutation({
    mutationFn: async (name: string) => {
      const res = await routes[kind].$post({ json: { name } });
      if (!res.ok) throw new Error(await errorMessage(res, '追加に失敗しました'));
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async (input: { id: string; name?: string; sortOrder?: number }) => {
      const { id, ...json } = input;
      const res = await routes[kind][':id'].$patch({ param: { id }, json });
      if (!res.ok) throw new Error(await errorMessage(res, '更新に失敗しました'));
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await routes[kind][':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error(await errorMessage(res, '削除に失敗しました'));
    },
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
