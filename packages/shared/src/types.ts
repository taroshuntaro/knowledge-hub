export type Role = 'member' | 'admin';
export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  avatarUrl: string | null;
  bio: string;
};
