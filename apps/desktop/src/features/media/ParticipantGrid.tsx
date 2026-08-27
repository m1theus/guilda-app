import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { HeadphoneOff, Mic, MicOff } from 'lucide-react';
import type { MediaParticipantState } from '@guilda/types';
import type { User } from '@guilda/types/entities';
import { Avatar } from '@guilda/ui';
import type { MediaRoomController } from './roomController';

export type ParticipantProfile = Pick<User, 'id' | 'displayName' | 'avatarUrl'>;

export interface ParticipantGridProps {
  controller: MediaRoomController;
  participants: MediaParticipantState[];
  members?: readonly ParticipantProfile[];
  mutedParticipantIds?: ReadonlySet<string>;
  focusedShareIdentity: string | null;
  onFocusShare(identity: string | null): void;
}

export function ParticipantGrid({
  controller,
  participants,
  members = [],
  mutedParticipantIds,
  focusedShareIdentity,
  onFocusShare,
}: ParticipantGridProps): JSX.Element {
  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const focused = focusedShareIdentity
    ? participants.find((participant) => participant.identity === focusedShareIdentity)
    : undefined;
  const visibleParticipants = focused ? [focused] : participants;
  return (
    <section aria-label="Voice participants" data-media-grid={focused ? 'focused' : 'grid'}>
      {focused ? (
        <button
          type="button"
          onClick={() => onFocusShare(null)}
          aria-label="Return to participant grid"
        >
          Return to grid
        </button>
      ) : null}
      <div className="media-participant-grid">
        {visibleParticipants.map((participant) => (
          <ParticipantTile
            key={participant.identity}
            controller={controller}
            participant={participant}
            member={membersById.get(participant.identity)}
            locallyMuted={mutedParticipantIds?.has(participant.identity) ?? false}
            showShare={Boolean(focused)}
            onFocusShare={onFocusShare}
          />
        ))}
      </div>
    </section>
  );
}

interface ParticipantTileProps {
  controller: MediaRoomController;
  participant: MediaParticipantState;
  member: ParticipantProfile | undefined;
  locallyMuted: boolean;
  showShare: boolean;
  onFocusShare(identity: string | null): void;
}

function ParticipantTile({
  controller,
  participant,
  member,
  locallyMuted,
  showShare,
  onFocusShare,
}: ParticipantTileProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const displayName = member?.displayName || participant.displayName || participant.identity;
  const videoSource = showShare || participant.screenShareEnabled ? 'screen' : 'camera';
  const videoEnabled =
    videoSource === 'screen' ? participant.screenShareEnabled : participant.cameraEnabled;
  const canFocusShare = participant.screenShareEnabled && !showShare;

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return undefined;
    }
    return controller.attachParticipantVideo(participant.identity, element, videoSource);
  }, [controller, participant.identity, videoEnabled, videoSource]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) {
      return undefined;
    }
    return controller.attachParticipantAudio(participant.identity, element);
  }, [controller, participant.identity, participant.microphoneEnabled]);

  const handleTileClick = (event: MouseEvent<HTMLElement>): void => {
    if (!canFocusShare || isInteractiveDescendant(event.target, event.currentTarget)) return;
    onFocusShare(participant.identity);
  };
  const handleTileKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (
      !canFocusShare ||
      isInteractiveDescendant(event.target, event.currentTarget) ||
      (event.key !== 'Enter' && event.key !== ' ')
    ) {
      return;
    }
    event.preventDefault();
    onFocusShare(participant.identity);
  };

  return (
    <article
      className={`${participant.isSpeaking ? 'media-participant speaking' : 'media-participant'} ${
        canFocusShare
          ? 'cursor-pointer transition hover:border-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'
          : ''
      }`}
      data-participant-identity={participant.identity}
      data-speaking={participant.isSpeaking}
      data-video-source={videoSource}
      role={canFocusShare ? 'button' : undefined}
      tabIndex={canFocusShare ? 0 : undefined}
      aria-label={canFocusShare ? `Focus ${displayName}'s shared screen` : undefined}
      onClick={handleTileClick}
      onKeyDown={handleTileKeyDown}
    >
      <div className="absolute inset-0 grid place-items-center bg-panelRaised">
        <Avatar name={displayName} src={member?.avatarUrl ?? null} size="lg" />
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.identity === 'local'}
        aria-hidden="true"
        className={`relative ${videoEnabled ? 'opacity-100' : 'opacity-0'}`}
      />
      <audio ref={audioRef} autoPlay muted={locallyMuted} />
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex min-w-0 items-end gap-2">
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-canvas/80 p-1 pr-2 shadow-lg">
          <Avatar name={displayName} src={member?.avatarUrl ?? null} size="sm" />
          <span className="truncate text-xs font-semibold text-ink">{displayName}</span>
          {videoSource === 'screen' ? (
            <span className="shrink-0 rounded bg-coral/15 px-1.5 py-0.5 text-[10px] font-bold text-coral">
              LIVE
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-canvas/80 p-2 shadow-lg">
          {participant.deafened ? (
            <span className="text-coral" aria-label="Deafened" title="Deafened">
              <HeadphoneOff size={15} aria-hidden="true" />
            </span>
          ) : null}
          <span
            className={participant.microphoneEnabled ? 'text-mint' : 'text-coral'}
            aria-label={participant.microphoneEnabled ? 'Microphone on' : 'Muted'}
            title={participant.microphoneEnabled ? 'Microphone on' : 'Muted'}
          >
            {participant.microphoneEnabled ? (
              <Mic size={15} aria-hidden="true" />
            ) : (
              <MicOff size={15} aria-hidden="true" />
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

function isInteractiveDescendant(target: EventTarget, currentTarget: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'button, a, input, select, textarea, summary, [role="button"], [role="link"]',
  );
  return interactive !== null && interactive !== currentTarget;
}
