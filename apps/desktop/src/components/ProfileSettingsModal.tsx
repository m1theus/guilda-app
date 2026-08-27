import { useEffect, useState } from 'react';
import type { UpdateProfileRequest } from '@guilda/types/api';
import type { User } from '@guilda/types/entities';
import { Avatar, Button, Modal } from '@guilda/ui';
import { useAuthStore } from '../store/appStore';

type ProfileSettingsModalProps = {
  user: User;
  onClose: () => void;
};

export function ProfileSettingsModal({ user, onClose }: ProfileSettingsModalProps) {
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [pronouns, setPronouns] = useState(user.pronouns ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [bannerUrl, setBannerUrl] = useState(user.bannerUrl ?? '');
  const [profileColor, setProfileColor] = useState(user.profileColor ?? '#9684FF');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSaving, onClose]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const input: UpdateProfileRequest = {
      displayName: displayName.trim(),
      pronouns: pronouns.trim() || null,
      bio: bio.trim() || null,
      avatarUrl: avatarUrl.trim() || null,
      bannerUrl: bannerUrl.trim() || null,
      profileColor: profileColor.trim() || null,
    };
    setIsSaving(true);
    try {
      await updateProfile(input);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Edit your profile"
      description="Make your corner of Guilda feel like yours."
      size="wide"
      closeDisabled={isSaving}
      onClose={() => {
        if (!isSaving) onClose();
      }}
    >
      <form className="space-y-5" onSubmit={submit}>
        <div
          className="relative h-36 overflow-hidden rounded-2xl border border-line"
          style={{
            backgroundColor: profileColor || '#9684FF',
            backgroundImage: bannerUrl.trim() ? `url(${bannerUrl.trim()})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
          <div className="absolute bottom-4 left-4 flex items-end gap-3">
            <Avatar name={displayName || user.username} src={avatarUrl || null} size="lg" />
            <div className="text-white">
              <p className="font-semibold">{displayName || 'Your display name'}</p>
              <p className="text-xs text-white/75">@{user.username}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Display name
            <input
              autoFocus
              required
              maxLength={64}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm outline-none focus:border-violet"
            />
          </label>
          <label className="block text-sm font-medium">
            Pronouns <span className="font-normal text-muted">(optional)</span>
            <input
              maxLength={40}
              value={pronouns}
              onChange={(event) => setPronouns(event.target.value)}
              placeholder="they/them"
              className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm outline-none focus:border-violet"
            />
          </label>
        </div>

        <label className="block text-sm font-medium">
          Bio <span className="float-right text-xs font-normal text-muted">{bio.length}/190</span>
          <textarea
            maxLength={190}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={3}
            placeholder="What are you making space for?"
            className="mt-2 w-full resize-none rounded-xl border border-line bg-canvas px-3 py-3 text-sm outline-none focus:border-violet"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Avatar URL <span className="font-normal text-muted">(HTTPS)</span>
            <input
              type="url"
              pattern="[hH][tT][tT][pP][sS]://.*"
              title="Use an HTTPS URL"
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="https://…"
              className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm outline-none focus:border-violet"
            />
          </label>
          <label className="block text-sm font-medium">
            Banner URL <span className="font-normal text-muted">(HTTPS)</span>
            <input
              type="url"
              pattern="[hH][tT][tT][pP][sS]://.*"
              title="Use an HTTPS URL"
              value={bannerUrl}
              onChange={(event) => setBannerUrl(event.target.value)}
              placeholder="https://…"
              className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm outline-none focus:border-violet"
            />
          </label>
        </div>

        <label className="block text-sm font-medium">
          Profile color
          <div className="mt-2 flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(profileColor) ? profileColor : '#9684FF'}
              onChange={(event) => setProfileColor(event.target.value.toUpperCase())}
              className="h-11 w-14 cursor-pointer rounded-xl border border-line bg-canvas p-1"
              aria-label="Choose profile color"
            />
            <input
              value={profileColor}
              onChange={(event) => setProfileColor(event.target.value)}
              maxLength={7}
              pattern="#[0-9a-fA-F]{6}"
              className="h-11 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm uppercase outline-none focus:border-violet"
              aria-label="Profile color hex value"
            />
          </div>
        </label>

        {error && (
          <p className="rounded-xl bg-coral/10 px-3 py-2 text-sm text-coral" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
