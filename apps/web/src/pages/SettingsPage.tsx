import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

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
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-bold tracking-tight">アカウント設定</h2>
      <Card>
        <CardHeader>
          <h3 className="leading-none font-semibold">プロフィール</h3>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSaveProfile} className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="settings-name">表示名</Label>
              <Input id="settings-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="settings-bio">自己紹介</Label>
              <Textarea id="settings-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={4} maxLength={2000} />
            </div>
            {profileMsg && <p role="status" className="text-sm text-muted-foreground">{profileMsg}</p>}
            <Button type="submit">保存</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h3 className="leading-none font-semibold">パスワード変更</h3>
        </CardHeader>
        <CardContent>
          <form onSubmit={onChangePassword} className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="settings-current-password">現在のパスワード</Label>
              <Input
                id="settings-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="settings-new-password">新しいパスワード（12文字以上）</Label>
              <Input
                id="settings-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={12}
              />
            </div>
            {passwordMsg && <p role="status" className="text-sm text-muted-foreground">{passwordMsg}</p>}
            <Button type="submit">変更する</Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
