import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './keys';

// GET /api/profiles のレスポンス型（サーバー profile-service.ts の ProfilesResponse と対応）
export type ProfileMaster = { id: string; name: string; sortOrder: number };
export type ProfileItem = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  hireYear: number | null;
};
export type ProfilesData = {
  users: ProfileItem[];
  departments: ProfileMaster[];
  positions: ProfileMaster[];
};

export function useProfiles() {
  return useQuery({
    queryKey: keys.profiles,
    queryFn: async (): Promise<ProfilesData> => {
      const res = await api.api.profiles.$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as ProfilesData;
    },
  });
}
