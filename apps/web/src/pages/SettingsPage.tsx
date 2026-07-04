import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';

export function SettingsPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    const res = await api.api.users.me.$patch({ json: { displayName, bio } });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      setProfileMsg('保存しました');
    } else {
      setProfileMsg('保存に失敗しました');
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    const res = await api.api.users.me.password.$post({ json: { currentPassword, newPassword } });
    if (res.ok) {
      setPasswordMsg('パスワードを変更しました');
      setCurrentPassword('');
      setNewPassword('');
    } else {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setPasswordMsg(body?.message ?? '変更に失敗しました');
    }
  }

  return (
    <section>
      <h2>アカウント設定</h2>
      <form onSubmit={onSaveProfile} className="auth-form">
        <h3>プロフィール</h3>
        <label>
          表示名
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        </label>
        <label>
          自己紹介
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} maxLength={2000} />
        </label>
        {profileMsg && <p role="status">{profileMsg}</p>}
        <button type="submit">保存</button>
      </form>
      <form onSubmit={onChangePassword} className="auth-form">
        <h3>パスワード変更</h3>
        <label>
          現在のパスワード
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>
          新しいパスワード（12文字以上）
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} />
        </label>
        {passwordMsg && <p role="status">{passwordMsg}</p>}
        <button type="submit">変更する</button>
      </form>
    </section>
  );
}
