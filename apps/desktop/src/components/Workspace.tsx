import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ArrowDownToLine,
  Check,
  Compass,
  Copy,
  Flag,
  Hash,
  HeadphoneOff,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  PanelRight,
  Paperclip,
  Pencil,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Shield,
  Smile,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  UserRoundX,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
import type {
  Attachment,
  Channel,
  DirectConversation,
  DirectMessage,
  GuildServer,
  Message,
  ModerationAction,
  ReportStatus,
  Role,
  ServerMember,
  User,
} from '@guilda/types/entities';
import { Permission } from '@guilda/types/entities';
import { Avatar, Button, EmptyState, IconButton, Modal, Spinner } from '@guilda/ui';
import type {
  DirectMessageCreatedEvent,
  DirectMessageDeletedEvent,
  DirectMessageUpdatedEvent,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageUpdatedEvent,
  MemberAuthorizationUpdatedEvent,
  PresenceUpdatedEvent,
  TypingEvent,
} from '@guilda/types/events';
import type {
  CreateReportRequest,
  DirectConversationListResponse,
  DirectMessagePage,
  InviteResponse,
} from '@guilda/types/api';
import type { MediaParticipantState } from '@guilda/types/media';
import { api } from '../lib/api';
import { connectRealtime, type GuildaSocket } from '../lib/realtime';
import { tokenStore } from '../lib/tokenStore';
import { useAuthStore, useWorkspaceStore } from '../store/appStore';
import { MediaRoomPanel, type MediaConnectionState } from '../features/media';
import { ProfileSettingsModal } from './ProfileSettingsModal';

type SendInput = {
  channelId: string;
  content: string;
  clientNonce: string;
  attachments: Attachment[];
};
type WorkspaceNotification =
  | {
      id: string;
      kind: 'channel';
      message: Message;
      channelName: string;
      serverId: string;
    }
  | {
      id: string;
      kind: 'direct';
      message: DirectMessage;
    };
const PREVIEWABLE_IMAGE_TYPES: Record<string, true> = {
  'image/avif': true,
  'image/gif': true,
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
};
const EMOJI_OPTIONS = [
  { emoji: '😀', label: 'grinning face' },
  { emoji: '😂', label: 'face with tears of joy' },
  { emoji: '😍', label: 'smiling face with heart eyes' },
  { emoji: '😎', label: 'smiling face with sunglasses' },
  { emoji: '🤔', label: 'thinking face' },
  { emoji: '😢', label: 'crying face' },
  { emoji: '😡', label: 'angry face' },
  { emoji: '👋', label: 'waving hand' },
  { emoji: '👍', label: 'thumbs up' },
  { emoji: '👏', label: 'clapping hands' },
  { emoji: '❤️', label: 'red heart' },
  { emoji: '🔥', label: 'fire' },
  { emoji: '✨', label: 'sparkles' },
  { emoji: '🎉', label: 'party popper' },
  { emoji: '💯', label: 'hundred points' },
  { emoji: '✅', label: 'check mark' },
  { emoji: '👀', label: 'eyes' },
  { emoji: '💡', label: 'light bulb' },
  { emoji: '🎯', label: 'bullseye' },
  { emoji: '🚀', label: 'rocket' },
  { emoji: '💻', label: 'laptop' },
  { emoji: '🎮', label: 'game controller' },
  { emoji: '🎨', label: 'artist palette' },
  { emoji: '🎵', label: 'musical note' },
  { emoji: '🎤', label: 'microphone' },
  { emoji: '📷', label: 'camera' },
  { emoji: '☕', label: 'hot beverage' },
  { emoji: '🍕', label: 'pizza' },
  { emoji: '🐶', label: 'dog face' },
  { emoji: '🐱', label: 'cat face' },
  { emoji: '🌟', label: 'glowing star' },
  { emoji: '🌈', label: 'rainbow' },
] as const;

function compareMessagesOldestFirst(left: Message, right: Message): number {
  const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return byCreatedAt || left.id.localeCompare(right.id);
}

function mergeMessagesOldestFirst(...groups: Message[][]): Message[] {
  const byId = new Map<string, Message>();
  for (const group of groups) {
    for (const message of group) byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareMessagesOldestFirst);
}

function normalizeMessagePage(page: MessagePageData): MessagePageData {
  return { ...page, items: mergeMessagesOldestFirst(page.items) };
}

function reconcileCreatedMessage(
  items: Message[],
  { message, clientNonce }: Pick<MessageCreatedEvent, 'message' | 'clientNonce'>,
): Message[] {
  const optimisticId = `optimistic-${clientNonce}`;
  return mergeMessagesOldestFirst(
    items.filter((item) => item.id !== optimisticId && item.id !== message.id),
    [message],
  );
}

function compareDirectMessagesOldestFirst(left: DirectMessage, right: DirectMessage): number {
  const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return byCreatedAt || left.id.localeCompare(right.id);
}

function reconcileCreatedDirectMessage(
  items: DirectMessage[],
  { message, clientNonce }: DirectMessageCreatedEvent,
): DirectMessage[] {
  const optimisticId = `optimistic-direct-${clientNonce}`;
  return [
    ...items.filter((item) => item.id !== optimisticId && item.id !== message.id),
    message,
  ].sort(compareDirectMessagesOldestFirst);
}

function conversationPartner(conversation: DirectConversation, currentUserId: string): User | null {
  return (
    conversation.members.find((member) => member.id !== currentUserId) ??
    conversation.members[0] ??
    null
  );
}
type ModalState =
  | 'create-server'
  | 'join-server'
  | 'accept-invite'
  | 'invite'
  | 'create-channel'
  | 'moderation'
  | 'roles'
  | 'profile'
  | null;
type AutomaticInviteState = {
  code: string;
  status: 'pending' | 'error';
  error: string | null;
};
type VoiceStateSnapshot = {
  state: MediaConnectionState;
  participants: MediaParticipantState[];
};
type ActiveVoiceState = VoiceStateSnapshot & { channelId: string };

export function Workspace({
  pendingInviteCode,
  onInviteConsumed,
}: {
  pendingInviteCode: string | null;
  onInviteConsumed: () => void;
}) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const {
    servers,
    activeServer,
    channels,
    members,
    activeChannelId,
    currentUserPermissions,
    isLoading,
    error,
    load,
    selectServer,
    selectChannel,
    addChannel,
    addServer,
    upsertMember,
    removeMember,
    updateMemberPermissions,
    refreshMembers,
    updatePresence,
  } = useWorkspaceStore();
  const [modal, setModal] = useState<ModalState>(null);
  const [showLogoutConfirmation, setShowLogoutConfirmation] = useState(false);
  const [automaticInvite, setAutomaticInvite] = useState<AutomaticInviteState | null>(null);
  const handledInviteCodes = useRef(new Set<string>());
  const currentAutomaticInviteCode = useRef<string | null>(null);
  const automaticInviteActive = useRef(true);
  const [showMembers, setShowMembers] = useState(true);
  const [showDMs, setShowDMs] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<Omit<CreateReportRequest, 'reason'> | null>(
    null,
  );
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [socket, setSocket] = useState<GuildaSocket | null>(null);
  const [voiceConnectionChannel, setVoiceConnectionChannel] = useState<Channel | null>(null);
  const [activeVoiceState, setActiveVoiceState] = useState<ActiveVoiceState | null>(null);
  const [mutedMemberIds, setMutedMemberIds] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();
  const voiceState = useQuery({
    queryKey: ['voice-state', activeServer?.id],
    queryFn: () => api.getVoiceState(activeServer!.id),
    enabled: Boolean(activeServer),
    refetchInterval: 10_000,
  });
  const canManageRoles = (currentUserPermissions & Permission.MANAGE_ROLES) !== 0;
  const canModerate =
    (currentUserPermissions & (Permission.KICK_MEMBERS | Permission.BAN_MEMBERS)) !== 0;
  const canUseModerationDesk =
    canModerate || (currentUserPermissions & Permission.MANAGE_SERVER) !== 0;
  const canManageChannels =
    Boolean(activeServer) && (currentUserPermissions & Permission.MANAGE_CHANNELS) !== 0;
  const canCreateInvite =
    Boolean(activeServer) && (currentUserPermissions & Permission.MANAGE_SERVER) !== 0;
  useEffect(() => {
    setNotifications([]);
    setShowNotifications(false);
    setShowSearch(false);
    setFocusMessageId(null);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    automaticInviteActive.current = true;
    return () => {
      automaticInviteActive.current = false;
    };
  }, []);
  const acceptInvite = useCallback(
    (server: GuildServer) => {
      addServer(server);
      void selectServer(server);
    },
    [addServer, selectServer],
  );
  const startAutomaticInvite = useCallback(
    (code: string) => {
      if (handledInviteCodes.current.has(code)) return;
      handledInviteCodes.current.add(code);
      currentAutomaticInviteCode.current = code;
      setAutomaticInvite({ code, status: 'pending', error: null });
      setModal('accept-invite');
      void api.acceptInvite(code).then(
        ({ server }) => {
          if (!automaticInviteActive.current || currentAutomaticInviteCode.current !== code) {
            return;
          }
          acceptInvite(server);
          setAutomaticInvite(null);
          setModal((current) => (current === 'accept-invite' ? null : current));
        },
        (error: unknown) => {
          handledInviteCodes.current.delete(code);
          if (!automaticInviteActive.current || currentAutomaticInviteCode.current !== code) {
            return;
          }
          setAutomaticInvite({
            code,
            status: 'error',
            error: error instanceof Error ? error.message : 'That invite is not available.',
          });
          setModal((current) => (current === null ? 'accept-invite' : current));
        },
      );
    },
    [acceptInvite],
  );
  useEffect(() => {
    if (!pendingInviteCode) return;
    startAutomaticInvite(pendingInviteCode);
    onInviteConsumed();
  }, [onInviteConsumed, pendingInviteCode, startAutomaticInvite]);
  const selectWorkspaceChannel = useCallback(
    (channelId: string, selectedChannel?: Channel) => {
      const channel = selectedChannel ?? channels.find((candidate) => candidate.id === channelId);
      selectChannel(channelId);
      if (channel?.type === 'VOICE') {
        setVoiceConnectionChannel(channel);
        setActiveVoiceState(null);
      }
    },
    [channels, selectChannel],
  );
  useEffect(() => {
    let disposed = false;
    let connection: GuildaSocket | null = null;
    void tokenStore
      .get()
      .then((tokens) => {
        if (disposed) return;
        connection = connectRealtime(tokens);
        setSocket(connection);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      connection?.disconnect();
      setSocket((current) => (current === connection ? null : current));
    };
  }, [user?.id]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = (event: MessageCreatedEvent) => {
      const queryKey = ['messages', event.message.channelId];
      queryClient.setQueryData<MessagePageData>(queryKey, (current) =>
        current ? { ...current, items: reconcileCreatedMessage(current.items, event) } : current,
      );
      const activeAndFocused =
        !showSearch &&
        !showNotifications &&
        modal === null &&
        !showDMs &&
        event.message.channelId === activeChannelId &&
        !document.hidden &&
        document.hasFocus() &&
        focusManager.isFocused() !== false;
      if (event.message.authorId !== user?.id && !activeAndFocused) {
        const notification: WorkspaceNotification = {
          id: `channel:${event.message.id}`,
          kind: 'channel',
          message: event.message,
          channelName: event.channelName,
          serverId: event.serverId,
        };
        setNotifications((current) =>
          [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50),
        );
      }
    };
    const onUpdated = ({ message }: MessageUpdatedEvent) => {
      queryClient.setQueryData<MessagePageData>(['messages', message.channelId], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === message.id ? message : item)),
            }
          : current,
      );
      setNotifications((current) =>
        current.map((notification) =>
          notification.kind === 'channel' && notification.message.id === message.id
            ? { ...notification, message }
            : notification,
        ),
      );
    };
    const onDeleted = ({ messageId, channelId, deletedAt }: MessageDeletedEvent) => {
      queryClient.setQueryData<MessagePageData>(['messages', channelId], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === messageId ? { ...item, deletedAt } : item,
              ),
            }
          : current,
      );
      setNotifications((current) =>
        current.filter(
          (notification) =>
            notification.kind !== 'channel' || notification.message.id !== messageId,
        ),
      );
    };
    const onPresence = ({ userId, status }: PresenceUpdatedEvent) => updatePresence(userId, status);
    const onMemberJoined = (member: ServerMember) => {
      if (member.serverId === activeServer?.id) upsertMember(member.user);
    };
    const onMemberUpdated = ({
      serverId,
      userId,
      permissions,
    }: MemberAuthorizationUpdatedEvent) => {
      void queryClient.invalidateQueries({ queryKey: ['member-roles', serverId, userId] });
      updateMemberPermissions(serverId, userId, permissions);
      if (serverId === activeServer?.id && userId === user?.id && activeServer) {
        void selectServer(activeServer);
        return;
      }
      if (
        serverId === activeServer?.id &&
        !useWorkspaceStore.getState().members.some((member) => member.id === userId)
      ) {
        void refreshMembers(serverId).catch(() => undefined);
      }
    };
    const onMemberLeft = ({ serverId, userId }: { serverId: string; userId: string }) => {
      if (serverId !== activeServer?.id) return;
      if (userId === user?.id) {
        void load();
      } else {
        removeMember(userId);
      }
    };
    const refreshFriendships = () => {
      void queryClient.invalidateQueries({ queryKey: ['friendships'] });
    };
    const refreshBlocks = () => {
      void queryClient.invalidateQueries({ queryKey: ['blocks'] });
    };
    const refreshConversations = () => {
      void queryClient.invalidateQueries({ queryKey: ['direct-conversations'] });
    };
    const onDirectMessageCreated = (event: DirectMessageCreatedEvent) => {
      queryClient.setQueryData<DirectMessagePage>(
        ['direct-messages', event.message.conversationId],
        (current) => ({
          items: reconcileCreatedDirectMessage(current?.items ?? [], event),
          nextCursor: current?.nextCursor ?? null,
        }),
      );
      const activeAndFocused =
        !showSearch &&
        !showNotifications &&
        modal === null &&
        showDMs &&
        event.message.conversationId === activeConversationId &&
        !document.hidden &&
        document.hasFocus() &&
        focusManager.isFocused() !== false;
      if (event.message.authorId !== user?.id && !activeAndFocused) {
        const notification: WorkspaceNotification = {
          id: `direct:${event.message.id}`,
          kind: 'direct',
          message: event.message,
        };
        setNotifications((current) =>
          [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50),
        );
      }
    };
    const onDirectMessageUpdated = ({ message }: DirectMessageUpdatedEvent) => {
      queryClient.setQueryData<DirectMessagePage>(
        ['direct-messages', message.conversationId],
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === message.id ? message : item)),
              }
            : current,
      );
      setNotifications((current) =>
        current.map((notification) =>
          notification.kind === 'direct' && notification.message.id === message.id
            ? { ...notification, message }
            : notification,
        ),
      );
    };
    const onDirectMessageDeleted = ({
      messageId,
      conversationId,
      deletedAt,
    }: DirectMessageDeletedEvent) => {
      queryClient.setQueryData<DirectMessagePage>(['direct-messages', conversationId], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === messageId ? { ...item, content: '', deletedAt } : item,
              ),
            }
          : current,
      );
      setNotifications((current) =>
        current.filter(
          (notification) => notification.kind !== 'direct' || notification.message.id !== messageId,
        ),
      );
    };

    socket.on('message:create', onCreated);
    socket.on('message:update', onUpdated);
    socket.on('message:delete', onDeleted);
    socket.on('presence:update', onPresence);
    socket.on('member:join', onMemberJoined);
    socket.on('member:update', onMemberUpdated);
    socket.on('member:leave', onMemberLeft);
    socket.on('friend-request:create', refreshFriendships);
    socket.on('friendship:update', refreshFriendships);
    socket.on('friendship:delete', refreshFriendships);
    socket.on('user-block:update', refreshBlocks);
    socket.on('user-block:delete', refreshBlocks);
    socket.on('direct-conversation:create', refreshConversations);
    socket.on('direct-message:create', onDirectMessageCreated);
    socket.on('direct-message:update', onDirectMessageUpdated);
    socket.on('direct-message:delete', onDirectMessageDeleted);
    return () => {
      socket.off('message:create', onCreated);
      socket.off('message:update', onUpdated);
      socket.off('message:delete', onDeleted);
      socket.off('presence:update', onPresence);
      socket.off('friend-request:create', refreshFriendships);
      socket.off('friendship:update', refreshFriendships);
      socket.off('friendship:delete', refreshFriendships);
      socket.off('member:join', onMemberJoined);
      socket.off('member:update', onMemberUpdated);
      socket.off('member:leave', onMemberLeft);
      socket.off('user-block:update', refreshBlocks);
      socket.off('user-block:delete', refreshBlocks);
      socket.off('direct-conversation:create', refreshConversations);
      socket.off('direct-message:create', onDirectMessageCreated);
      socket.off('direct-message:update', onDirectMessageUpdated);
      socket.off('direct-message:delete', onDirectMessageDeleted);
    };
  }, [
    activeServer?.id,
    activeChannelId,
    activeConversationId,
    channels,
    load,
    modal,
    queryClient,
    showDMs,
    showNotifications,
    showSearch,
    socket,
    selectServer,
    refreshMembers,
    removeMember,
    updatePresence,
    updateMemberPermissions,
    upsertMember,
    user?.id,
  ]);
  const updateActiveVoiceState = useCallback(
    (channelId: string, state: VoiceStateSnapshot) => setActiveVoiceState({ channelId, ...state }),
    [],
  );
  const voiceParticipants = Object.fromEntries(
    (voiceState.data?.channels ?? []).map((channel) => [channel.channelId, channel.participants]),
  ) as Record<string, MediaParticipantState[]>;
  if (activeVoiceState?.state === 'joined') {
    voiceParticipants[activeVoiceState.channelId] = activeVoiceState.participants;
  }

  const activeChannel = channels.find((channel) => channel.id === activeChannelId) ?? null;
  const currentPresence =
    members.find((member) => member.id === user?.id)?.status ?? user?.status ?? 'OFFLINE';
  if (isLoading && !activeServer) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas">
        <Spinner label="Warming up your spaces" />
      </div>
    );
  }
  if (error && !activeServer) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-6">
        <div className="space-y-4 text-center">
          <EmptyState title="Could not open Guilda" description={error} icon={<Wifi size={20} />} />
          <Button type="button" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main className="flex h-screen min-w-[960px] overflow-hidden bg-canvas text-ink">
      <aside className="flex w-[76px] shrink-0 flex-col items-center border-r border-line bg-[#0d0e12] py-4">
        <BrandMark active={showDMs} onClick={() => setShowDMs(true)} />
        <div className="my-4 h-px w-9 bg-line" />
        <nav className="flex flex-1 flex-col items-center gap-3" aria-label="Spaces">
          {servers.map((server) => (
            <ServerButton
              key={server.id}
              server={server}
              active={!showDMs && activeServer?.id === server.id}
              onClick={() => {
                setShowDMs(false);
                void selectServer(server);
              }}
            />
          ))}
          <IconButton
            label="Create a space"
            onClick={() => setModal('create-server')}
            className="bg-mint/10 text-mint hover:bg-mint/20"
          >
            <Plus size={19} />
          </IconButton>
          <IconButton
            label="Join a space"
            onClick={() => setModal('join-server')}
            className="bg-violet/10 text-violet hover:bg-violet/20"
          >
            <Compass size={18} />
          </IconButton>
        </nav>
      </aside>

      <aside className="flex w-[250px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-[68px] items-center gap-2 border-b border-line px-4">
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl font-bold ${
              showDMs
                ? 'bg-violet text-canvas'
                : 'bg-gradient-to-br from-violet to-mint text-canvas'
            }`}
          >
            {showDMs ? (
              <MessageCircle size={16} aria-hidden="true" />
            ) : (
              (activeServer?.name.slice(0, 1).toUpperCase() ?? 'G')
            )}
          </span>
          <span className="truncate text-sm font-semibold">
            {showDMs ? 'Direct messages' : (activeServer?.name ?? 'Your spaces')}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {showDMs && user ? (
            <DMList
              currentUser={user}
              activeConversationId={activeConversationId}
              onSelectConversation={setActiveConversationId}
            />
          ) : (
            <ChannelList
              channels={channels}
              members={members}
              voiceParticipants={voiceParticipants}
              activeChannelId={activeChannelId}
              isLoading={isLoading}
              error={error}
              hasServer={Boolean(activeServer)}
              onSelect={selectWorkspaceChannel}
              {...(canManageChannels ? { onCreate: () => setModal('create-channel') } : {})}
              {...(activeServer ? { onRetry: () => void selectServer(activeServer) } : {})}
            />
          )}
        </div>
        {user && (
          <div className="border-t border-line bg-[#131419] p-3">
            <div className="flex items-center gap-2">
              <Avatar
                name={user.displayName}
                src={user.avatarUrl}
                status={currentPresence}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{user.displayName}</p>
                <p className="truncate text-[11px] text-muted">@{user.username}</p>
              </div>
              <IconButton label="Edit profile" onClick={() => setModal('profile')}>
                <Pencil size={15} />
              </IconButton>
              <IconButton label="Sign out" onClick={() => setShowLogoutConfirmation(true)}>
                <LogOut size={15} />
              </IconButton>
            </div>
          </div>
        )}
      </aside>

      <section className={`flex min-w-0 flex-1 flex-col bg-[#121318] ${showDMs ? 'hidden' : ''}`}>
        <ChannelHeader
          channel={activeChannel}
          onInvite={canCreateInvite ? () => setModal('invite') : null}
          onSearch={() => setShowSearch(true)}
          onToggleMembers={() => setShowMembers((current) => !current)}
          notifications={notifications.length}
          onNotifications={() => setShowNotifications(true)}
        />
        <VoiceRoom
          channel={voiceConnectionChannel}
          members={members}
          mutedMemberIds={mutedMemberIds}
          visible={!showDMs && activeChannel?.type === 'VOICE'}
          onVoiceStateChange={updateActiveVoiceState}
          onLeave={() => {
            setVoiceConnectionChannel(null);
            setActiveVoiceState(null);
          }}
        />
        {activeChannel?.type !== 'VOICE' && (
          <MessagePane
            channelId={activeChannelId}
            serverId={activeServer?.id ?? null}
            currentUser={user}
            socket={socket}
            onReport={(target) => setReportTarget(target)}
            onInviteAccepted={acceptInvite}
            focusMessageId={focusMessageId}
            onFocusComplete={() => setFocusMessageId(null)}
          />
        )}
      </section>
      {showDMs && user && (
        <DMPanel
          currentUser={user}
          activeConversationId={activeConversationId}
          onInviteAccepted={acceptInvite}
        />
      )}
      {!showDMs && showMembers && activeServer && user && (
        <MemberRail
          members={members}
          currentUser={user}
          ownerId={activeServer.ownerId}
          mutedMemberIds={mutedMemberIds}
          canManageRoles={canManageRoles}
          canModerate={canUseModerationDesk}
          onModerate={() => setModal('moderation')}
          onManageRoles={() => setModal('roles')}
          onOpenConversation={(conversation) => {
            setActiveConversationId(conversation.id);
            setShowDMs(true);
          }}
          onToggleMute={(memberId) =>
            setMutedMemberIds((current) => {
              const next = new Set(current);
              if (next.has(memberId)) next.delete(memberId);
              else next.add(memberId);
              return next;
            })
          }
          onReportUser={(targetUserId) =>
            setReportTarget({ serverId: activeServer.id, targetUserId })
          }
        />
      )}

      {modal === 'create-server' && (
        <CreateServerDialog
          onClose={() => setModal(null)}
          onCreated={(server) => {
            addServer(server);
            void selectServer(server);
            setModal(null);
          }}
        />
      )}
      {modal === 'accept-invite' && automaticInvite && (
        <AutomaticJoinDialog
          invite={automaticInvite}
          onClose={() => setModal(null)}
          onRetry={() => startAutomaticInvite(automaticInvite.code)}
        />
      )}
      {modal === 'join-server' && (
        <JoinDialog
          onClose={() => setModal(null)}
          onJoined={(server) => {
            addServer(server);
            void selectServer(server);
            setModal(null);
          }}
        />
      )}
      {modal === 'invite' && activeServer && canCreateInvite && (
        <InviteDialog serverId={activeServer.id} onClose={() => setModal(null)} />
      )}
      {modal === 'create-channel' && activeServer && canManageChannels && (
        <CreateChannelDialog
          serverId={activeServer.id}
          onClose={() => setModal(null)}
          onCreated={(channel) => {
            addChannel(channel);
            selectWorkspaceChannel(channel.id, channel);
            setModal(null);
          }}
        />
      )}
      {modal === 'moderation' && activeServer && user && canUseModerationDesk && (
        <ModerationDialog
          serverId={activeServer.id}
          members={members}
          currentUserId={user.id}
          ownerId={activeServer.ownerId}
          permissions={currentUserPermissions}
          onMemberRemoved={removeMember}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'roles' && activeServer && canManageRoles && (
        <RoleManagementDialog
          serverId={activeServer.id}
          ownerId={activeServer.ownerId}
          managerPermissions={currentUserPermissions}
          members={members}
          onClose={() => setModal(null)}
        />
      )}
      {reportTarget && <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />}
      {showSearch && activeServer && (
        <SearchMessagesDialog
          serverId={activeServer.id}
          channels={channels}
          onClose={() => setShowSearch(false)}
          onNavigate={(message) => {
            queryClient.setQueryData<MessagePageData>(
              ['messages', message.channelId],
              (current) => ({
                items: mergeMessagesOldestFirst(current?.items ?? [], [message]),
                nextCursor: current?.nextCursor ?? null,
              }),
            );
            setShowDMs(false);
            selectChannel(message.channelId);
            setFocusMessageId(message.id);
            setShowSearch(false);
          }}
        />
      )}
      {showNotifications && (
        <NotificationsDialog
          notifications={notifications}
          onClose={() => setShowNotifications(false)}
          onClear={() => setNotifications([])}
          onDismiss={(notificationId) =>
            setNotifications((current) =>
              current.filter((notification) => notification.id !== notificationId),
            )
          }
          onOpen={(notification) => {
            setNotifications((current) =>
              current.filter((candidate) => candidate.id !== notification.id),
            );
            setShowNotifications(false);
            if (notification.kind === 'direct') {
              setActiveConversationId(notification.message.conversationId);
              setShowDMs(true);
              return;
            }
            queryClient.setQueryData<MessagePageData>(
              ['messages', notification.message.channelId],
              (current) => ({
                items: mergeMessagesOldestFirst(current?.items ?? [], [notification.message]),
                nextCursor: current?.nextCursor ?? null,
              }),
            );
            setShowDMs(false);
            const targetServer = servers.find((server) => server.id === notification.serverId);
            void (async () => {
              if (targetServer && targetServer.id !== activeServer?.id) {
                await selectServer(targetServer);
              }
              selectChannel(notification.message.channelId);
              setFocusMessageId(notification.message.id);
            })();
          }}
        />
      )}
      {modal === 'profile' && user && (
        <ProfileSettingsModal user={user} onClose={() => setModal(null)} />
      )}
      {showLogoutConfirmation && (
        <LogoutConfirmationDialog
          onClose={() => setShowLogoutConfirmation(false)}
          onConfirm={() => {
            setShowLogoutConfirmation(false);
            void logout();
          }}
        />
      )}
    </main>
  );
}
function ChannelList({
  channels,
  members,
  voiceParticipants,
  activeChannelId,
  isLoading,
  error,
  hasServer,
  onSelect,
  onCreate,
  onRetry,
}: {
  channels: Channel[];
  members: User[];
  voiceParticipants: Record<string, MediaParticipantState[]>;
  activeChannelId: string | null;
  isLoading: boolean;
  error: string | null;
  hasServer: boolean;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  onRetry?: () => void;
}) {
  if (isLoading) {
    return (
      <div className="py-8">
        <Spinner label="Loading channels…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3 rounded-xl border border-coral/30 bg-coral/10 p-3">
        <p className="text-xs leading-5 text-coral" role="alert">
          {error}
        </p>
        {onRetry && (
          <Button type="button" variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (!hasServer) {
    return <p className="px-2 py-6 text-sm text-muted">Create or join a space to get started.</p>;
  }
  const text = channels.filter((channel) => channel.type === 'TEXT');
  const voice = channels.filter((channel) => channel.type === 'VOICE');
  return (
    <div className="space-y-5">
      <ChannelGroup
        title="Conversations"
        icon={<Hash size={12} />}
        channels={text}
        activeChannelId={activeChannelId}
        onSelect={onSelect}
        {...(onCreate ? { onCreate } : {})}
      />
      <ChannelGroup
        title="Hangouts"
        icon={<Volume2 size={12} />}
        channels={voice}
        members={members}
        voiceParticipants={voiceParticipants}
        activeChannelId={activeChannelId}
        onSelect={onSelect}
      />
    </div>
  );
}

type MessagePageData = { items: Message[]; nextCursor: string | null };
function BrandMark({ active, onClick }: { active: boolean; onClick: () => void }) {
  const label = 'Open direct messages';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={`grid h-11 w-11 place-items-center rounded-2xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
        active
          ? 'rounded-xl bg-violet text-canvas shadow-glow'
          : 'bg-panelRaised text-violet hover:rounded-xl hover:bg-violet/30 hover:text-ink'
      }`}
    >
      <Sparkles size={21} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
function ServerButton({
  server,
  active,
  onClick,
}: {
  server: { name: string; iconUrl: string | null };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={`Open ${server.name}`}
      className={`group relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl text-sm font-bold transition ${active ? 'rounded-xl bg-violet text-canvas' : 'bg-panelRaised text-muted hover:rounded-xl hover:bg-violet/30 hover:text-ink'}`}
    >
      {server.iconUrl ? (
        <img src={server.iconUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        server.name.slice(0, 2).toUpperCase()
      )}
    </button>
  );
}
function ChannelGroup({
  title,
  icon,
  channels,
  members = [],
  voiceParticipants,
  activeChannelId,
  onSelect,
  onCreate,
}: {
  title: string;
  icon: React.ReactNode;
  channels: Channel[];
  members?: User[];
  voiceParticipants?: Record<string, MediaParticipantState[]>;
  activeChannelId: string | null;
  onSelect: (id: string) => void;
  onCreate?: () => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted">
        {icon}
        {title}
        {onCreate && (
          <button
            onClick={onCreate}
            className="ml-auto rounded p-1 text-muted hover:bg-white/10 hover:text-ink"
            aria-label={`Create ${title}`}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {channels.length ? (
        <div className="space-y-1">
          {channels.map((channel) => {
            const participants = voiceParticipants?.[channel.id] ?? [];
            return (
              <div key={channel.id}>
                <button
                  onClick={() => onSelect(channel.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${activeChannelId === channel.id ? 'bg-violet/15 font-semibold text-ink' : 'text-muted hover:bg-white/[.05] hover:text-ink'}`}
                >
                  {channel.type === 'TEXT' ? (
                    <Hash
                      size={16}
                      className={activeChannelId === channel.id ? 'text-violet' : ''}
                    />
                  ) : (
                    <Volume2
                      size={16}
                      className={
                        participants.length > 0
                          ? 'text-mint'
                          : activeChannelId === channel.id
                            ? 'text-mint'
                            : ''
                      }
                    />
                  )}
                  <span className="truncate">{channel.name}</span>
                </button>
                {channel.type === 'VOICE' && participants.length > 0 ? (
                  <div className="ml-5 space-y-0.5 pb-1 pt-0.5">
                    {participants.map((participant) => (
                      <VoiceParticipantRow
                        key={participant.identity}
                        participant={participant}
                        member={members.find((candidate) => candidate.id === participant.identity)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-2 text-xs text-muted">No channels yet</p>
      )}
    </section>
  );
}

function VoiceParticipantRow({
  participant,
  member,
}: {
  participant: MediaParticipantState;
  member: User | undefined;
}) {
  const displayName = member?.displayName ?? participant.displayName;
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-muted"
      aria-label={`${displayName}, ${participant.microphoneEnabled ? 'microphone on' : 'muted'}`}
    >
      <span
        className={
          participant.isSpeaking
            ? 'rounded-xl ring-2 ring-mint ring-offset-2 ring-offset-panel'
            : undefined
        }
      >
        <Avatar name={displayName} src={member?.avatarUrl ?? null} status="ONLINE" size="sm" />
      </span>
      <span className={`min-w-0 flex-1 truncate ${participant.isSpeaking ? 'text-mint' : ''}`}>
        {displayName}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {participant.cameraEnabled ? (
          <span aria-label="Camera on" title="Camera on" className="text-mint">
            <Video size={13} />
          </span>
        ) : null}
        {participant.screenShareEnabled ? (
          <span
            aria-label="Sharing screen"
            title="Sharing screen"
            className="inline-flex items-center gap-1 rounded bg-coral/15 px-1 py-0.5 text-[9px] font-bold text-coral"
          >
            <MonitorUp size={11} />
            LIVE
          </span>
        ) : null}
        {participant.deafened ? (
          <span aria-label="Deafened" title="Deafened" className="text-coral">
            <HeadphoneOff size={14} />
          </span>
        ) : null}
        <span
          aria-label={participant.microphoneEnabled ? 'Microphone on' : 'Muted'}
          title={participant.microphoneEnabled ? 'Microphone on' : 'Muted'}
          className={participant.microphoneEnabled ? 'text-mint' : 'text-coral'}
        >
          {participant.microphoneEnabled ? <Mic size={14} /> : <MicOff size={14} />}
        </span>
      </span>
    </div>
  );
}
function DMList({
  currentUser,
  activeConversationId,
  onSelectConversation,
}: {
  currentUser: User;
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const friendships = useQuery({
    queryKey: ['friendships'],
    queryFn: () => api.getFriendships(),
  });
  const conversations = useQuery({
    queryKey: ['direct-conversations'],
    queryFn: () => api.getDirectConversations(),
  });
  const accept = useMutation({
    mutationFn: (requesterId: string) => api.acceptFriendRequest(requesterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['friendships'] }),
  });
  const dismiss = useMutation({
    mutationFn: (otherUserId: string) => api.deleteFriendRequest(otherUserId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['friendships'] }),
  });
  const removeFriend = useMutation({
    mutationFn: (userId: string) => api.deleteFriendship(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['friendships'] }),
  });
  const openConversation = useMutation({
    mutationFn: (otherUserId: string) => api.createDirectConversation({ otherUserId }),
    onSuccess: (conversation) => {
      queryClient.setQueryData<DirectConversationListResponse>(
        ['direct-conversations'],
        (current) => ({
          items: [
            ...(current?.items ?? []).filter((item) => item.id !== conversation.id),
            conversation,
          ],
        }),
      );
      onSelectConversation(conversation.id);
    },
  });
  const incoming =
    friendships.data?.items.filter(
      (friendship) => friendship.status === 'PENDING' && friendship.addresseeId === currentUser.id,
    ) ?? [];
  const outgoing =
    friendships.data?.items.filter(
      (friendship) => friendship.status === 'PENDING' && friendship.requesterId === currentUser.id,
    ) ?? [];
  const friends =
    friendships.data?.items.filter((friendship) => friendship.status === 'ACCEPTED') ?? [];
  const error =
    friendships.error ??
    conversations.error ??
    accept.error ??
    dismiss.error ??
    removeFriend.error ??
    openConversation.error;

  if (friendships.isLoading || conversations.isLoading) {
    return (
      <div className="grid py-8 place-items-center">
        <Spinner label="Loading direct messages" />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-lg bg-coral/10 px-2 py-2 text-xs text-coral">
          {error instanceof Error ? error.message : 'Direct messages could not be loaded.'}
        </p>
      )}
      {incoming.length > 0 && (
        <section aria-labelledby="incoming-friends">
          <p
            id="incoming-friends"
            className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted"
          >
            Incoming requests
          </p>
          <div className="space-y-1">
            {incoming.map((friendship) => (
              <div
                key={friendship.pairKey}
                className="flex items-center gap-2 rounded-xl bg-white/[.03] px-2 py-2"
              >
                <Avatar
                  name={friendship.requester.displayName}
                  src={friendship.requester.avatarUrl}
                  status={friendship.requester.status}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {friendship.requester.displayName}
                </span>
                <IconButton
                  label={`Accept ${friendship.requester.displayName}'s friend request`}
                  className="h-7 w-7 text-mint"
                  disabled={accept.isPending || dismiss.isPending}
                  onClick={() => accept.mutate(friendship.requesterId)}
                >
                  <Check size={14} />
                </IconButton>
                <IconButton
                  label={`Decline ${friendship.requester.displayName}'s friend request`}
                  className="h-7 w-7 text-coral"
                  disabled={accept.isPending || dismiss.isPending}
                  onClick={() => dismiss.mutate(friendship.requesterId)}
                >
                  <X size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="direct-conversations">
        <p
          id="direct-conversations"
          className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted"
        >
          Conversations
        </p>
        {conversations.data?.items.length ? (
          <div className="space-y-1">
            {[...conversations.data.items]
              .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
              .map((conversation) => {
                const partner = conversationPartner(conversation, currentUser.id);
                if (!partner) return null;
                return (
                  <button
                    key={conversation.id}
                    onClick={() => onSelectConversation(conversation.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left ${
                      activeConversationId === conversation.id
                        ? 'bg-violet/15'
                        : 'hover:bg-white/[.05]'
                    }`}
                  >
                    <Avatar
                      name={partner.displayName}
                      src={partner.avatarUrl}
                      size="sm"
                      status={partner.status}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {partner.displayName}
                    </span>
                  </button>
                );
              })}
          </div>
        ) : (
          <p className="px-2 text-xs text-muted">No conversations yet.</p>
        )}
      </section>
      <section aria-labelledby="friends-list">
        <p
          id="friends-list"
          className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted"
        >
          Friends
        </p>
        {friends.length ? (
          <div className="space-y-1">
            {friends.map((friendship) => {
              const friend =
                friendship.requesterId === currentUser.id
                  ? friendship.addressee
                  : friendship.requester;
              return (
                <div
                  key={friendship.pairKey}
                  className="flex items-center gap-1 rounded-xl hover:bg-white/[.05]"
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                    onClick={() => openConversation.mutate(friend.id)}
                    disabled={openConversation.isPending}
                  >
                    <Avatar
                      name={friend.displayName}
                      src={friend.avatarUrl}
                      status={friend.status}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">
                      {friend.displayName}
                    </span>
                    <MessageCircle size={14} className="text-violet" />
                  </button>
                  <IconButton
                    label={`Remove ${friend.displayName} as a friend`}
                    className="mr-1 h-7 w-7 text-coral"
                    disabled={removeFriend.isPending}
                    onClick={() => removeFriend.mutate(friend.id)}
                  >
                    <UserRoundX size={13} />
                  </IconButton>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-2 text-xs text-muted">Friends you accept will appear here.</p>
        )}
        {outgoing.map((friendship) => (
          <div
            key={friendship.pairKey}
            className="mt-2 flex items-center gap-2 px-2 text-xs text-muted"
          >
            <span className="min-w-0 flex-1 truncate">
              Requested {friendship.addressee.displayName}
            </span>
            <button
              className="text-coral hover:underline"
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate(friendship.addresseeId)}
            >
              Cancel
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
function SearchMessagesDialog({
  serverId,
  channels,
  onClose,
  onNavigate,
}: {
  serverId: string;
  channels: Channel[];
  onClose: () => void;
  onNavigate: (message: Message) => void;
}) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const queryClient = useQueryClient();
  const search = useQuery({
    queryKey: ['message-search', serverId, submittedQuery],
    queryFn: () => api.searchMessages(serverId, submittedQuery),
    enabled: submittedQuery.length >= 2,
  });
  const loadMore = useMutation({
    mutationFn: (cursor: string) => api.searchMessages(serverId, submittedQuery, cursor),
    onSuccess: (page) =>
      queryClient.setQueryData<MessagePageData>(
        ['message-search', serverId, submittedQuery],
        (current) => ({
          items: [
            ...(current?.items ?? []),
            ...page.items.filter(
              (message) => !current?.items.some((candidate) => candidate.id === message.id),
            ),
          ],
          nextCursor: page.nextCursor,
        }),
      ),
  });
  const channelNames = Object.fromEntries(
    channels.map((channel) => [channel.id, channel.name]),
  ) as Record<string, string>;

  return (
    <Modal
      title="Search messages"
      description="Find messages in channels you can access in this space."
      onClose={onClose}
      size="wide"
    >
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const nextQuery = query.trim();
          if (nextQuery.length < 2) return;
          loadMore.reset();
          if (nextQuery === submittedQuery) void search.refetch();
          else setSubmittedQuery(nextQuery);
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search terms</span>
          <input
            autoFocus
            type="search"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search message text"
            className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-violet"
          />
        </label>
        <Button type="submit" disabled={query.trim().length < 2 || search.isFetching}>
          {search.isFetching ? 'Searching…' : 'Search'}
        </Button>
      </form>
      <div className="mt-5 max-h-[55vh] overflow-y-auto" aria-live="polite">
        {!submittedQuery ? (
          <p className="py-8 text-center text-sm text-muted">
            Enter at least two characters to search this space.
          </p>
        ) : search.isLoading ? (
          <div className="grid place-items-center py-10">
            <Spinner label="Searching messages" />
          </div>
        ) : search.isError ? (
          <EmptyState
            title="Search is unavailable"
            description="Messages could not be searched. Check your connection and try again."
            icon={<Wifi size={20} />}
          />
        ) : search.data?.items.length ? (
          <div>
            <ul className="space-y-2" aria-label="Message search results">
              {search.data.items.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-left transition hover:border-violet/50 hover:bg-white/[.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                    onClick={() => onNavigate(message)}
                  >
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <Hash size={13} aria-hidden="true" />
                      <span>{channelNames[message.channelId] ?? 'Channel'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{message.author.displayName}</span>
                      <time className="ml-auto" dateTime={message.createdAt}>
                        {formatTime(message.createdAt)}
                      </time>
                    </span>
                    <span className="mt-1.5 block whitespace-pre-wrap break-words text-sm text-ink">
                      {message.content ||
                        (message.attachments.length === 1
                          ? `Attachment: ${message.attachments[0]?.filename}`
                          : `${message.attachments.length} attachments`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {loadMore.isError ? (
              <p role="alert" className="mt-3 text-center text-xs text-coral">
                More results could not be loaded. Try again.
              </p>
            ) : null}
            {search.data.nextCursor ? (
              <Button
                variant="ghost"
                className="mx-auto mt-3 flex"
                disabled={loadMore.isPending}
                onClick={() => {
                  if (search.data.nextCursor) loadMore.mutate(search.data.nextCursor);
                }}
              >
                {loadMore.isPending ? 'Loading…' : 'Load more results'}
              </Button>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="No messages found"
            description={`No accessible messages match “${submittedQuery}”.`}
            icon={<Search size={20} />}
          />
        )}
      </div>
    </Modal>
  );
}

function NotificationsDialog({
  notifications,
  onClose,
  onClear,
  onDismiss,
  onOpen,
}: {
  notifications: WorkspaceNotification[];
  onClose: () => void;
  onClear: () => void;
  onDismiss: (notificationId: string) => void;
  onOpen: (notification: WorkspaceNotification) => void;
}) {
  return (
    <Modal
      title="Notifications"
      description="Unread channel and direct messages received while you were elsewhere."
      onClose={onClose}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted" role="status">
          {notifications.length === 0
            ? 'No unread notifications'
            : `${notifications.length} unread notification${notifications.length === 1 ? '' : 's'}`}
        </p>
        <Button variant="ghost" disabled={notifications.length === 0} onClick={onClear}>
          Clear all
        </Button>
      </div>
      {notifications.length === 0 ? (
        <EmptyState
          title="You’re all caught up"
          description="New messages received while you are elsewhere will appear here."
          icon={<Bell size={20} />}
        />
      ) : (
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto" aria-label="Unread notifications">
          {notifications.map((notification) => {
            const message = notification.message;
            const destination =
              notification.kind === 'channel' ? `#${notification.channelName}` : 'Direct message';
            return (
              <li
                key={notification.id}
                className="flex items-stretch gap-1 rounded-xl border border-line bg-panel p-1"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-lg px-3 py-2 text-left transition hover:bg-white/[.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                  onClick={() => onOpen(notification)}
                >
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <span className="font-semibold text-ink">{message.author.displayName}</span>
                    <span>{destination}</span>
                    <time className="ml-auto" dateTime={message.createdAt}>
                      {formatTime(message.createdAt)}
                    </time>
                  </span>
                  <span className="mt-1 block truncate text-sm text-ink">
                    {message.content || 'Sent an attachment'}
                  </span>
                </button>
                <IconButton
                  label={`Mark notification from ${message.author.displayName} as read`}
                  className="my-auto h-8 w-8 shrink-0"
                  onClick={() => onDismiss(notification.id)}
                >
                  <Check size={15} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function ChannelHeader({
  channel,
  onInvite,
  onSearch,
  onToggleMembers,
  notifications,
  onNotifications,
}: {
  channel: Channel | null;
  onInvite: (() => void) | null;
  onSearch: () => void;
  onToggleMembers: () => void;
  notifications: number;
  onNotifications: () => void;
}) {
  return (
    <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line px-5">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet/10 text-violet">
        {channel?.type === 'VOICE' ? <Volume2 size={17} /> : <Hash size={17} />}
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">
          {channel?.name ?? 'Choose a conversation'}
        </h1>
        <p className="truncate text-xs text-muted">
          {channel?.type === 'VOICE'
            ? 'A quiet place to hang out'
            : 'Share the good stuff with your people'}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {onInvite ? (
          <button
            onClick={onInvite}
            className="hidden items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-mint hover:bg-mint/10 sm:flex"
          >
            <UserPlus size={15} /> Invite
          </button>
        ) : null}
        <IconButton label="Search messages" disabled={!channel} onClick={onSearch}>
          <Search size={18} />
        </IconButton>
        <div className="relative">
          <IconButton label="Notifications" onClick={onNotifications}>
            <Bell size={18} />
          </IconButton>
          {notifications > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[9px] font-bold text-white"
            >
              {notifications > 99 ? '99+' : notifications}
            </span>
          )}
        </div>
        <IconButton label="Toggle member list" onClick={onToggleMembers}>
          <PanelRight size={18} />
        </IconButton>
      </div>
    </header>
  );
}
function MessagePane({
  channelId,
  serverId,
  currentUser,
  socket,
  onReport,
  onInviteAccepted,
  focusMessageId,
  onFocusComplete,
}: {
  channelId: string | null;
  serverId: string | null;
  currentUser: User | null;
  socket: GuildaSocket | null;
  onReport: (target: Omit<CreateReportRequest, 'reason'>) => void;
  onInviteAccepted: (server: GuildServer) => void;
  focusMessageId: string | null;
  onFocusComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const emojiControl = useRef<HTMLDivElement>(null);
  const emojiPicker = useRef<HTMLElement>(null);
  const activeChannelRef = useRef(channelId);
  activeChannelRef.current = channelId;
  const focusMessageRef = useRef(focusMessageId);
  focusMessageRef.current = focusMessageId;
  useEffect(() => {
    setAttachments([]);
    setUploadError(null);
    setIsUploading(false);
    setEmojiPickerOpen(false);
  }, [channelId]);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!emojiPickerOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!emojiPicker.current?.contains(target) && !emojiControl.current?.contains(target))
        setEmojiPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setEmojiPickerOpen(false);
      emojiControl.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [emojiPickerOpen]);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['messages', channelId],
    queryFn: async () => normalizeMessagePage(await api.getMessages(channelId ?? '')),
    enabled: Boolean(channelId),
    staleTime: 15_000,
  });
  const messages = data?.items ?? [];
  const loadOlder = useMutation({
    mutationFn: (cursor: string) => api.getMessages(channelId ?? '', cursor),
    onSuccess: (page) => {
      const normalized = normalizeMessagePage(page);
      queryClient.setQueryData<MessagePageData>(['messages', channelId], (current) =>
        current
          ? {
              items: mergeMessagesOldestFirst(normalized.items, current.items),
              nextCursor: normalized.nextCursor,
            }
          : normalized,
      );
    },
  });
  const send = useMutation({
    mutationFn: ({
      channelId: targetChannelId,
      content,
      clientNonce,
      attachments: pendingAttachments,
    }: SendInput) => {
      const attachmentIds = pendingAttachments.map((attachment) => attachment.id);
      const command = { content, clientNonce, attachmentIds };
      if (!socket?.connected) return api.sendMessage(targetChannelId, command);
      return new Promise<Message>((resolve, reject) => {
        const timeout = globalThis.setTimeout(() => {
          void api.sendMessage(targetChannelId, command).then(resolve, reject);
        }, 10_000);
        socket.emit('message:create', { channelId: targetChannelId, ...command }, (result) => {
          globalThis.clearTimeout(timeout);
          if (typeof result.message === 'string') {
            reject(new Error(result.message));
          } else {
            resolve(result.message);
          }
        });
      });
    },
    onMutate: async ({
      channelId: targetChannelId,
      content,
      clientNonce,
      attachments: pendingAttachments,
    }) => {
      const queryKey = ['messages', targetChannelId] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MessagePageData>(queryKey);
      if (currentUser) {
        const now = new Date().toISOString();
        const optimistic: Message = {
          id: `optimistic-${clientNonce}`,
          channelId: targetChannelId,
          authorId: currentUser.id,
          content,
          replyToId: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          author: currentUser,
          attachments: pendingAttachments,
        };
        queryClient.setQueryData<MessagePageData>(queryKey, (value) => ({
          items: mergeMessagesOldestFirst(value?.items ?? [], [optimistic]),
          nextCursor: value?.nextCursor ?? null,
        }));
      }
      return { previous, queryKey };
    },
    onError: (error, input, context) => {
      queryClient.setQueryData(
        context?.queryKey ?? ['messages', input.channelId],
        context?.previous,
      );
      if (activeChannelRef.current === input.channelId) {
        setDraft((current) => current || input.content);
        setAttachments(input.attachments);
        setUploadError(error instanceof Error ? error.message : 'The message could not be sent.');
      }
    },
    onSuccess: (message, input) =>
      queryClient.setQueryData<MessagePageData>(['messages', input.channelId], (value) => ({
        items: reconcileCreatedMessage(value?.items ?? [], {
          message,
          clientNonce: input.clientNonce,
        }),
        nextCursor: value?.nextCursor ?? null,
      })),
  });
  const edit = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.updateMessage(id, { content }),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagePageData>(['messages', channelId], (value) =>
        value
          ? {
              ...value,
              items: value.items.map((item) => (item.id === message.id ? message : item)),
            }
          : value,
      );
      setEditingId(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMessage(id),
    onSuccess: (_result, id) =>
      queryClient.setQueryData<MessagePageData>(['messages', channelId], (value) =>
        value
          ? {
              ...value,
              items: value.items.map((item) =>
                item.id === id ? { ...item, deletedAt: new Date().toISOString() } : item,
              ),
            }
          : value,
      ),
  });
  useEffect(() => {
    if (focusMessageRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.at(-1)?.id, channelId]);
  useLayoutEffect(() => {
    if (!focusMessageId || !messages.some((message) => message.id === focusMessageId)) return;
    const target = document.getElementById(`message-${focusMessageId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
    const timeout = globalThis.setTimeout(onFocusComplete, 2_000);
    return () => globalThis.clearTimeout(timeout);
  }, [focusMessageId, messages, onFocusComplete]);
  useEffect(() => {
    if (!socket) return;
    const start = (event: TypingEvent) => {
      if (event.channelId === channelId)
        setTypingNames((names) =>
          names.includes(event.userId) ? names : [...names, event.userId],
        );
    };
    const stop = (event: TypingEvent) => {
      if (event.channelId === channelId)
        setTypingNames((names) => names.filter((name) => name !== event.userId));
    };
    socket.on('typing:start', start);
    socket.on('typing:stop', stop);
    return () => {
      socket.off('typing:start', start);
      socket.off('typing:stop', stop);
    };
  }, [channelId, socket]);
  const submit = () => {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || !channelId || isUploading) return;
    const clientNonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    send.mutate({
      channelId,
      content,
      attachments,
      clientNonce,
    });
    setDraft('');
    socket?.emit('typing:stop', { channelId });
    setAttachments([]);
    setUploadError(null);
  };
  const onDraft = (value: string) => {
    setDraft(value);
    if (channelId) socket?.emit(value ? 'typing:start' : 'typing:stop', { channelId });
  };
  const insertEmoji = (emoji: string) => {
    const input = messageInput.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? draft.length;
    const nextDraft = `${draft.slice(0, selectionStart)}${emoji}${draft.slice(selectionEnd)}`;
    const nextCaret = selectionStart + emoji.length;
    onDraft(nextDraft);
    setEmojiPickerOpen(false);
    globalThis.requestAnimationFrame(() => {
      messageInput.current?.focus();
      messageInput.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };
  const upload = async (file: File) => {
    if (!channelId || attachments.length >= 10) return;
    const uploadChannelId = channelId;
    setIsUploading(true);
    setUploadError(null);
    try {
      const attachment = await api.createUpload(uploadChannelId, file);
      if (activeChannelRef.current === uploadChannelId)
        setAttachments((current) => [...current, attachment]);
    } catch (error) {
      if (activeChannelRef.current === uploadChannelId)
        setUploadError(error instanceof Error ? error.message : 'The file could not be uploaded.');
    } finally {
      if (activeChannelRef.current === uploadChannelId) setIsUploading(false);
    }
  };
  if (!channelId)
    return (
      <EmptyState
        title="Pick a conversation"
        description="Choose a channel from the left to join the room."
        icon={<Hash size={22} />}
      />
    );
  if (isLoading)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner label="Loading messages" />
      </div>
    );
  if (isError)
    return (
      <EmptyState
        title="Messages took a wrong turn"
        description="Check your connection and try again."
        icon={<Wifi size={22} />}
      />
    );
  const messageActionError = edit.error ?? remove.error ?? loadOlder.error;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl">
          {data?.nextCursor ? (
            <button
              type="button"
              className="mx-auto mb-4 block rounded-lg px-3 py-1.5 text-xs text-muted transition hover:bg-white/[.05] hover:text-ink disabled:opacity-50"
              disabled={loadOlder.isPending}
              onClick={() => {
                if (data.nextCursor) loadOlder.mutate(data.nextCursor);
              }}
            >
              {loadOlder.isPending ? 'Loading…' : 'Load older messages'}
            </button>
          ) : null}
          {messageActionError ? (
            <p role="alert" className="mb-3 text-center text-xs text-coral">
              The message action failed. Check your connection and try again.
            </p>
          ) : null}
          {messages.length === 0 ? (
            <EmptyState
              title="The room is all yours"
              description="Start the conversation with a thought, a question, or a little spark."
              icon={<Sparkles size={22} />}
            />
          ) : (
            messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                currentUser={currentUser}
                editing={editingId === message.id}
                highlighted={focusMessageId === message.id}
                onStartEdit={() => setEditingId(message.id)}
                onCancelEdit={() => setEditingId(null)}
                onSubmitEdit={(content) => edit.mutate({ id: message.id, content })}
                onDelete={() => remove.mutate(message.id)}
                onInviteAccepted={onInviteAccepted}
                onReport={() => {
                  if (serverId) {
                    onReport({
                      serverId,
                      messageId: message.id,
                      targetUserId: message.authorId,
                    });
                  }
                }}
              />
            ))
          )}
          {typingNames.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              <span className="mr-2 inline-flex gap-0.5">
                <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet" />
                <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet [animation-delay:100ms]" />
                <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet [animation-delay:200ms]" />
              </span>
              {typingNames.length === 1 ? 'Someone is' : `${typingNames.length} people are`} shaping
              a message…
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="px-5 pb-5">
        <div className="mx-auto max-w-3xl">
          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex max-w-xs items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs text-ink"
                >
                  <span className="truncate">{attachment.filename}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.filename}`}
                    className="text-muted hover:text-coral"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((candidate) => candidate.id !== attachment.id),
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {uploadError ? (
            <p role="alert" className="mb-2 px-2 text-xs text-coral">
              {uploadError}
            </p>
          ) : null}
          {isUploading ? <p className="mb-2 px-2 text-xs text-muted">Uploading file…</p> : null}
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel px-3 py-2.5 shadow-lg focus-within:border-violet/70">
            <input
              ref={fileInput}
              type="file"
              disabled={isUploading || attachments.length >= 10}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = '';
              }}
            />
            <IconButton
              label={attachments.length >= 10 ? 'Attachment limit reached' : 'Attach a file'}
              onClick={() => {
                if (!isUploading && attachments.length < 10) fileInput.current?.click();
              }}
            >
              <Paperclip size={18} />
            </IconButton>
            <textarea
              ref={messageInput}
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Say something kind…"
              rows={1}
              className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-ink outline-none placeholder:text-muted/70"
              aria-label="Message"
            />
            <div ref={emojiControl} className="relative">
              <IconButton
                label="Add emoji"
                aria-expanded={emojiPickerOpen}
                aria-controls="message-emoji-picker"
                aria-haspopup="dialog"
                className={emojiPickerOpen ? 'bg-white/[.08] text-ink' : ''}
                onClick={() => setEmojiPickerOpen((open) => !open)}
              >
                <Smile size={18} />
              </IconButton>
              {emojiPickerOpen ? (
                <section
                  ref={emojiPicker}
                  id="message-emoji-picker"
                  role="dialog"
                  aria-label="Choose an emoji"
                  className="absolute bottom-12 right-0 z-50 w-80 rounded-2xl border border-line bg-panelRaised p-3 shadow-2xl shadow-black/50"
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <div>
                      <p className="text-sm font-semibold text-ink">Emojis</p>
                      <p className="text-[11px] text-muted">Choose one to add to your message</p>
                    </div>
                    <IconButton
                      label="Close emoji picker"
                      className="h-8 w-8"
                      onClick={() => {
                        setEmojiPickerOpen(false);
                        emojiControl.current?.querySelector<HTMLButtonElement>('button')?.focus();
                      }}
                    >
                      <X size={15} />
                    </IconButton>
                  </div>
                  <div className="grid grid-cols-8 gap-1" aria-label="Available emojis">
                    {EMOJI_OPTIONS.map(({ emoji, label }) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={`Insert ${label}`}
                        title={label}
                        className="grid h-9 w-9 place-items-center rounded-lg text-xl transition hover:bg-white/[.08] focus-visible:bg-white/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertEmoji(emoji)}
                      >
                        <span aria-hidden="true">{emoji}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
            <button
              onClick={submit}
              disabled={
                (!draft.trim() && attachments.length === 0) || send.isPending || isUploading
              }
              aria-label="Send message"
              className="grid h-9 w-9 place-items-center rounded-xl bg-violet text-white transition hover:bg-violetDark disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="mt-2 px-2 text-[11px] text-muted">
            Enter to send · Shift + Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
function InviteMessageContent({
  content,
  onInviteAccepted,
}: {
  content: string;
  onInviteAccepted: (server: GuildServer) => void;
}) {
  const match = /https:\/\/noxera\.online\/invite\/([A-Za-z0-9_-]{4,100})(?![A-Za-z0-9_/?#-])/.exec(
    content,
  );
  const mutation = useMutation({
    mutationFn: () => api.acceptInvite(match?.[1] ?? ''),
    onSuccess: ({ server }) => onInviteAccepted(server),
  });
  return (
    <>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#d3d3db]">
        {content}
      </p>
      {match ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="soft"
            disabled={mutation.isPending || mutation.isSuccess}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? 'Accepting invite…'
              : mutation.isSuccess
                ? 'Invite accepted'
                : 'Accept invite'}
          </Button>
          {mutation.error ? (
            <p role="alert" className="text-xs text-coral">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'That invite is not available.'}
            </p>
          ) : null}
          {mutation.isSuccess ? (
            <p role="status" className="text-xs text-mint">
              Joined {mutation.data?.server.name}.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function MessageRow({
  message,
  currentUser,
  editing,
  highlighted,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  onReport,
  onInviteAccepted,
}: {
  message: Message;
  currentUser: User | null;
  highlighted: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (content: string) => void;
  onDelete: () => void;
  onReport: () => void;
  onInviteAccepted: (server: GuildServer) => void;
}) {
  const [value, setValue] = useState(message.content);
  useEffect(() => {
    if (editing) setValue(message.content);
  }, [editing, message.content]);
  if (message.deletedAt)
    return (
      <div className="group flex gap-3 rounded-2xl px-3 py-3 opacity-60">
        <Avatar name={message.author.displayName} src={message.author.avatarUrl} size="sm" />
        <p className="py-1 text-sm italic text-muted">This message was removed.</p>
      </div>
    );
  return (
    <article
      id={`message-${message.id}`}
      tabIndex={-1}
      className={`group relative flex gap-3 rounded-2xl px-3 py-3 outline-none transition ${
        highlighted ? 'bg-violet/10 ring-2 ring-violet/70' : 'hover:bg-white/[.03]'
      }`}
    >
      <Avatar
        name={message.author.displayName}
        src={message.author.avatarUrl}
        size="md"
        status={message.author.status}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink">{message.author.displayName}</span>
          <span className="text-[11px] text-muted">{formatTime(message.createdAt)}</span>
          {message.updatedAt !== message.createdAt && (
            <span className="text-[10px] text-muted">(edited)</span>
          )}
        </div>
        {editing ? (
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              aria-label="Edit message"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && value.trim()) {
                  onSubmitEdit(value.trim());
                }
              }}
              className="flex-1 rounded-lg border border-violet bg-canvas px-3 py-2 text-sm outline-none"
            />
            <Button variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
            <Button disabled={!value.trim()} onClick={() => onSubmitEdit(value.trim())}>
              Save
            </Button>
          </div>
        ) : (
          <>
            {message.content ? (
              <InviteMessageContent content={message.content} onInviteAccepted={onInviteAccepted} />
            ) : null}
            {message.attachments.length > 0 ? (
              <div className="mt-2 grid max-w-xl gap-2">
                {message.attachments.map((attachment) => (
                  <AttachmentView key={attachment.id} attachment={attachment} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
      {!editing && !message.id.startsWith('optimistic-') && (
        <div className="absolute right-3 top-1 flex rounded-lg border border-line bg-panelRaised p-1 opacity-0 shadow-xl transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {currentUser?.id === message.authorId ? (
            <>
              <IconButton label="Edit message" className="h-7 w-7" onClick={onStartEdit}>
                <Pencil size={13} />
              </IconButton>
              <IconButton label="Delete message" className="h-7 w-7 text-coral" onClick={onDelete}>
                <Trash2 size={13} />
              </IconButton>
            </>
          ) : (
            <IconButton
              label={`Report message from ${message.author.displayName}`}
              className="h-7 w-7 text-coral"
              onClick={onReport}
            >
              <Flag size={13} />
            </IconButton>
          )}
        </div>
      )}
    </article>
  );
}
function AttachmentView({ attachment }: { attachment: Attachment }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let currentUrl: string | null = null;
    void api
      .getAttachmentContent(attachment.id)
      .then((blob) => {
        if (disposed) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : 'Attachment could not be loaded.');
      });
    return () => {
      disposed = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [attachment.id]);

  if (error)
    return (
      <p
        role="alert"
        className="rounded-xl border border-coral/30 bg-coral/5 px-3 py-2 text-xs text-coral"
      >
        {attachment.filename}: {error}
      </p>
    );
  if (!objectUrl)
    return (
      <div className="rounded-xl border border-line bg-panel px-3 py-2 text-xs text-muted">
        Loading {attachment.filename}…
      </div>
    );
  if (PREVIEWABLE_IMAGE_TYPES[attachment.mimeType.toLowerCase()])
    return (
      <>
        <button
          type="button"
          aria-label={`Open ${attachment.filename} preview`}
          onClick={() => setIsPreviewOpen(true)}
          className="block overflow-hidden rounded-xl border border-line bg-panel text-left transition hover:border-violet/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
        >
          <img
            src={objectUrl}
            alt={attachment.filename}
            className="max-h-80 w-auto max-w-full object-contain"
          />
          <span className="block truncate px-3 py-2 text-xs text-muted">{attachment.filename}</span>
        </button>
        {isPreviewOpen ? (
          <Modal
            title={attachment.filename}
            description={`${attachment.mimeType} · ${formatFileSize(attachment.size)}`}
            size="wide"
            onClose={() => setIsPreviewOpen(false)}
          >
            <div className="relative overflow-hidden rounded-2xl border border-line bg-black/40">
              <img
                src={objectUrl}
                alt={attachment.filename}
                className="max-h-[70vh] w-full object-contain"
              />
              <a
                href={objectUrl}
                download={attachment.filename}
                aria-label={`Download ${attachment.filename}`}
                title={`Download ${attachment.filename}`}
                className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-black/70 text-white shadow-lg backdrop-blur transition hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
              >
                <ArrowDownToLine size={18} />
              </a>
            </div>
          </Modal>
        ) : null}
      </>
    );
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs text-violet">
      <Paperclip size={14} />
      <span className="truncate">{attachment.filename}</span>
      <span className="ml-auto shrink-0 text-muted">{formatFileSize(attachment.size)}</span>
      <a
        href={objectUrl}
        download={attachment.filename}
        aria-label={`Download ${attachment.filename}`}
        title={`Download ${attachment.filename}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-white/[.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
      >
        <ArrowDownToLine size={15} />
      </a>
    </div>
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}
function VoiceRoom({
  channel,
  members,
  mutedMemberIds,
  visible,
  onVoiceStateChange,
  onLeave,
}: {
  channel: Channel | null;
  members: User[];
  mutedMemberIds: ReadonlySet<string>;
  visible: boolean;
  onVoiceStateChange: (channelId: string, state: VoiceStateSnapshot) => void;
  onLeave: () => void;
}) {
  const token = useMutation({
    mutationFn: async (channelId: string) => ({
      channelId,
      value: await api.getMediaToken(channelId),
    }),
  });
  const { mutate, reset } = token;
  useEffect(() => {
    reset();
    if (channel) mutate(channel.id);
  }, [channel?.id, mutate, reset]);
  const handleVoiceStateChange = useCallback(
    (state: VoiceStateSnapshot) => {
      if (channel) onVoiceStateChange(channel.id, state);
    },
    [channel, onVoiceStateChange],
  );
  if (!channel) return null;
  const channelToken = token.data?.channelId === channel.id ? token.data.value : undefined;
  const containerClassName = visible
    ? 'flex min-h-0 flex-1 flex-col overflow-y-auto p-5'
    : 'hidden';
  return (
    <>
      {channelToken ? (
        <div className={visible ? containerClassName : 'hidden'}>
          <MediaRoomPanel
            token={channelToken}
            members={members}
            mutedMemberIds={mutedMemberIds}
            onLeave={() => {
              reset();
              onLeave();
            }}
            onVoiceStateChange={handleVoiceStateChange}
          />
        </div>
      ) : visible ? (
        <div className={`${containerClassName} items-center justify-center gap-4 p-10 text-center`}>
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-violet/10 text-violet">
            <Radio size={22} />
          </span>
          <div>
            <h3 className="font-semibold text-ink">Join {channel.name}</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
              Voice starts muted. Camera and screen sharing only start when you turn them on.
            </p>
          </div>
          {token.error ? (
            <p role="alert" className="max-w-sm text-sm text-coral">
              Could not join voice. Check your access and connection, then retry.
            </p>
          ) : null}
          <Button onClick={() => mutate(channel.id)} disabled={token.isPending}>
            {token.isPending ? 'Joining…' : token.error ? 'Retry voice' : 'Join voice'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
type MemberMenuState = {
  memberId: string;
  x: number;
  y: number;
  trigger: HTMLElement;
};

const MEMBER_MENU_VIEWPORT_PADDING = 8;

function MemberRail({
  members,
  currentUser,
  ownerId,
  mutedMemberIds,
  canManageRoles,
  canModerate,
  onModerate,
  onManageRoles,
  onOpenConversation,
  onToggleMute,
  onReportUser,
}: {
  members: User[];
  currentUser: User;
  ownerId: string;
  mutedMemberIds: ReadonlySet<string>;
  canManageRoles: boolean;
  canModerate: boolean;
  onModerate: () => void;
  onManageRoles: () => void;
  onOpenConversation: (conversation: DirectConversation) => void;
  onToggleMute: (memberId: string) => void;
  onReportUser: (userId: string) => void;
}) {
  const queryClient = useQueryClient();
  const menuRef = useRef<HTMLDivElement>(null);
  const [memberMenu, setMemberMenu] = useState<MemberMenuState | null>(null);
  const blocks = useQuery({ queryKey: ['blocks'], queryFn: () => api.getBlocks() });
  const friendships = useQuery({
    queryKey: ['friendships'],
    queryFn: () => api.getFriendships(),
  });
  const startConversation = useMutation({
    mutationFn: (otherUserId: string) => api.createDirectConversation({ otherUserId }),
    onSuccess: (conversation) => {
      queryClient.setQueryData<DirectConversationListResponse>(
        ['direct-conversations'],
        (current) => ({
          items: [
            ...(current?.items ?? []).filter((item) => item.id !== conversation.id),
            conversation,
          ],
        }),
      );
      onOpenConversation(conversation);
    },
  });
  const updateBlock = useMutation({
    mutationFn: async ({ userId, blocked }: { userId: string; blocked: boolean }) => {
      if (blocked) {
        await api.unblockUser(userId);
      } else {
        await api.blockUser(userId);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['blocks'] });
      void queryClient.invalidateQueries({ queryKey: ['friendships'] });
      void queryClient.invalidateQueries({ queryKey: ['direct-conversations'] });
    },
  });
  const addFriend = useMutation({
    mutationFn: (addresseeId: string) => api.createFriendRequest({ addresseeId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['friendships'] }),
  });
  const online = members.filter((member) => member.status !== 'OFFLINE');
  const offline = members.filter((member) => member.status === 'OFFLINE');
  const selectedMember = memberMenu
    ? (members.find((member) => member.id === memberMenu.memberId) ?? null)
    : null;
  const selectedMemberBlocked = selectedMember
    ? (blocks.data?.items.some((block) => block.blockedId === selectedMember.id) ?? false)
    : false;
  const selectedMemberMuted = selectedMember ? mutedMemberIds.has(selectedMember.id) : false;
  const selectedFriendship = selectedMember
    ? friendships.data?.items.find(
        (item) => item.requesterId === selectedMember.id || item.addresseeId === selectedMember.id,
      )
    : undefined;
  const friendshipState = selectedFriendship
    ? selectedFriendship.status === 'ACCEPTED'
      ? 'Friends'
      : selectedFriendship.requesterId === currentUser.id
        ? 'Friend request sent'
        : 'Friend request received'
    : null;
  const socialActionsReady = blocks.isSuccess && friendships.isSuccess;
  const selectedMemberIsFriend = selectedFriendship?.status === 'ACCEPTED';
  const error =
    blocks.error ??
    friendships.error ??
    startConversation.error ??
    updateBlock.error ??
    addFriend.error;

  useLayoutEffect(() => {
    if (!memberMenu) return;
    const menu = menuRef.current;
    if (!menu) return;

    const bounds = menu.getBoundingClientRect();
    const left = Math.max(
      MEMBER_MENU_VIEWPORT_PADDING,
      Math.min(memberMenu.x, window.innerWidth - bounds.width - MEMBER_MENU_VIEWPORT_PADDING),
    );
    const top = Math.max(
      MEMBER_MENU_VIEWPORT_PADDING,
      Math.min(memberMenu.y, window.innerHeight - bounds.height - MEMBER_MENU_VIEWPORT_PADDING),
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) setMemberMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMemberMenu(null);
      if (memberMenu.trigger.isConnected) memberMenu.trigger.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [memberMenu]);

  const actionProps = {
    currentUser,
    ownerId,
    activeMemberId: memberMenu?.memberId ?? null,
    onOpenActions: setMemberMenu,
  };
  const runMenuAction = (action: () => void) => {
    setMemberMenu(null);
    action();
  };
  const menuItemClassName =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-white/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent';

  return (
    <aside className="hidden w-[260px] shrink-0 overflow-y-auto border-l border-line bg-panel p-4 xl:block">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted">
          People · {members.length}
        </p>
        <div className="flex gap-1">
          {canManageRoles && (
            <IconButton label="Manage roles" className="h-7 w-7" onClick={onManageRoles}>
              <Settings size={14} />
            </IconButton>
          )}
          {canModerate && (
            <IconButton label="Moderation" className="h-7 w-7" onClick={onModerate}>
              <Shield size={15} />
            </IconButton>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-coral/10 px-2 py-2 text-xs text-coral">
          {error instanceof Error ? error.message : 'Member actions are unavailable.'}
        </p>
      )}
      {(blocks.isLoading || friendships.isLoading) && (
        <p className="mb-3 text-xs text-muted">Loading member actions…</p>
      )}
      <MemberGroup label="Here now" members={online} {...actionProps} />
      <MemberGroup label="Away" members={offline} {...actionProps} />
      {memberMenu && selectedMember && selectedMember.id !== currentUser.id && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${selectedMember.displayName}`}
          className="fixed z-50 max-h-[calc(100vh-1rem)] w-52 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-line bg-panelRaised p-1.5 shadow-2xl"
          style={{ left: memberMenu.x, top: memberMenu.y }}
          onKeyDown={(event) => {
            if (
              event.key !== 'ArrowDown' &&
              event.key !== 'ArrowUp' &&
              event.key !== 'Home' &&
              event.key !== 'End'
            ) {
              return;
            }
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
              ),
            );
            if (!items.length) return;
            event.preventDefault();
            const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
            const nextIndex =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : event.key === 'ArrowUp'
                    ? (currentIndex - 1 + items.length) % items.length
                    : (currentIndex + 1) % items.length;
            items[nextIndex]?.focus();
          }}
        >
          {!socialActionsReady && (
            <button type="button" role="menuitem" className={menuItemClassName} disabled>
              <Users size={15} aria-hidden="true" />
              {blocks.isLoading || friendships.isLoading
                ? 'Loading social actions…'
                : 'Social actions unavailable'}
            </button>
          )}
          {socialActionsReady && selectedMemberIsFriend && !selectedMemberBlocked && (
            <button
              type="button"
              role="menuitem"
              className={menuItemClassName}
              disabled={startConversation.isPending}
              onClick={() => runMenuAction(() => startConversation.mutate(selectedMember.id))}
            >
              <MessageCircle size={15} aria-hidden="true" />
              Send message
            </button>
          )}
          {socialActionsReady &&
            !selectedMemberBlocked &&
            (friendshipState ? (
              <button type="button" role="menuitem" className={menuItemClassName} disabled>
                <Check size={15} aria-hidden="true" />
                {friendshipState}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className={menuItemClassName}
                disabled={!socialActionsReady || addFriend.isPending}
                onClick={() => runMenuAction(() => addFriend.mutate(selectedMember.id))}
              >
                <UserPlus size={15} aria-hidden="true" />
                Add friend
              </button>
            ))}
          <button
            type="button"
            role="menuitem"
            className={menuItemClassName}
            onClick={() => runMenuAction(() => onToggleMute(selectedMember.id))}
          >
            {selectedMemberMuted ? (
              <Volume2 size={15} aria-hidden="true" />
            ) : (
              <VolumeX size={15} aria-hidden="true" />
            )}
            {selectedMemberMuted ? 'Unmute' : 'Mute'}
          </button>
          <div className="my-1 border-t border-line" role="separator" />
          <button
            type="button"
            role="menuitem"
            className={`${menuItemClassName} ${selectedMemberBlocked ? 'text-mint' : 'text-coral'}`}
            disabled={!socialActionsReady || updateBlock.isPending}
            onClick={() =>
              runMenuAction(() =>
                updateBlock.mutate({
                  userId: selectedMember.id,
                  blocked: selectedMemberBlocked,
                }),
              )
            }
          >
            <UserRoundX size={15} aria-hidden="true" />
            {selectedMemberBlocked ? 'Unblock' : 'Block'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${menuItemClassName} text-coral`}
            onClick={() => runMenuAction(() => onReportUser(selectedMember.id))}
          >
            <Flag size={15} aria-hidden="true" />
            Report
          </button>
        </div>
      )}
    </aside>
  );
}

function MemberGroup({
  label,
  members,
  currentUser,
  ownerId,
  activeMemberId,
  onOpenActions,
}: {
  label: string;
  members: User[];
  currentUser: User;
  ownerId: string;
  activeMemberId: string | null;
  onOpenActions: (menu: MemberMenuState) => void;
}) {
  return (
    <section className="mb-6">
      <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label} — {members.length}
      </p>
      <div className="space-y-1">
        {members.map((member) => {
          const isCurrentUser = member.id === currentUser.id;
          return (
            <div
              key={member.id}
              role={isCurrentUser ? undefined : 'button'}
              tabIndex={isCurrentUser ? undefined : 0}
              aria-haspopup={isCurrentUser ? undefined : 'menu'}
              aria-expanded={isCurrentUser ? undefined : activeMemberId === member.id}
              aria-label={isCurrentUser ? undefined : `Open actions for ${member.displayName}`}
              className={`rounded-xl px-1 py-2 transition hover:bg-white/[.05] ${
                isCurrentUser
                  ? ''
                  : 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet'
              }`}
              onClick={(event) => {
                if (isCurrentUser) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                onOpenActions({
                  memberId: member.id,
                  x: bounds.left,
                  y: bounds.bottom,
                  trigger: event.currentTarget,
                });
              }}
              onContextMenu={(event) => {
                if (isCurrentUser) return;
                event.preventDefault();
                onOpenActions({
                  memberId: member.id,
                  x: event.clientX,
                  y: event.clientY,
                  trigger: event.currentTarget,
                });
              }}
              onKeyDown={(event) => {
                if (
                  isCurrentUser ||
                  (event.key !== 'Enter' &&
                    event.key !== ' ' &&
                    event.key !== 'ContextMenu' &&
                    !(event.shiftKey && event.key === 'F10'))
                ) {
                  return;
                }
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                onOpenActions({
                  memberId: member.id,
                  x: bounds.left,
                  y: bounds.bottom,
                  trigger: event.currentTarget,
                });
              }}
            >
              <div className="flex items-center gap-2">
                <Avatar
                  name={member.displayName}
                  src={member.avatarUrl}
                  status={member.status}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {member.displayName}
                </span>
                {member.id === ownerId && <span className="text-[9px] text-mint">owner</span>}
                {isCurrentUser && <span className="text-[9px] text-violet">you</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DMPanel({
  currentUser,
  activeConversationId,
  onInviteAccepted,
}: {
  currentUser: User;
  activeConversationId: string | null;
  onInviteAccepted: (server: GuildServer) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversations = useQuery({
    queryKey: ['direct-conversations'],
    queryFn: () => api.getDirectConversations(),
  });
  const history = useQuery({
    queryKey: ['direct-messages', activeConversationId],
    queryFn: () => api.getDirectMessages(activeConversationId ?? ''),
    enabled: Boolean(activeConversationId),
  });
  const activeConversation =
    conversations.data?.items.find((conversation) => conversation.id === activeConversationId) ??
    null;
  const partner = activeConversation
    ? conversationPartner(activeConversation, currentUser.id)
    : null;
  const messages = [...(history.data?.items ?? [])].sort(compareDirectMessagesOldestFirst);
  const loadOlder = useMutation({
    mutationFn: (cursor: string) => api.getDirectMessages(activeConversationId ?? '', cursor),
    onSuccess: (page) =>
      queryClient.setQueryData<DirectMessagePage>(
        ['direct-messages', activeConversationId],
        (current) => ({
          items: [
            ...page.items,
            ...(current?.items ?? []).filter(
              (item) => !page.items.some((older) => older.id === item.id),
            ),
          ].sort(compareDirectMessagesOldestFirst),
          nextCursor: page.nextCursor,
        }),
      ),
  });
  const send = useMutation({
    mutationFn: ({ content, clientNonce }: { content: string; clientNonce: string }) =>
      api.sendDirectMessage(activeConversationId ?? '', { content, clientNonce }),
    onMutate: async ({ content, clientNonce }) => {
      const key = ['direct-messages', activeConversationId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DirectMessagePage>(key);
      const timestamp = new Date().toISOString();
      const optimistic: DirectMessage = {
        id: `optimistic-direct-${clientNonce}`,
        conversationId: activeConversationId ?? '',
        authorId: currentUser.id,
        content,
        clientNonce,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        author: currentUser,
      };
      queryClient.setQueryData<DirectMessagePage>(key, (current) => ({
        items: [...(current?.items ?? []), optimistic].sort(compareDirectMessagesOldestFirst),
        nextCursor: current?.nextCursor ?? null,
      }));
      return { previous };
    },
    onError: (_error, input, context) => {
      queryClient.setQueryData(['direct-messages', activeConversationId], context?.previous);
      setDraft((current) => current || input.content);
    },
    onSuccess: (message, input) =>
      queryClient.setQueryData<DirectMessagePage>(
        ['direct-messages', activeConversationId],
        (current) => ({
          items: reconcileCreatedDirectMessage(current?.items ?? [], {
            message,
            clientNonce: input.clientNonce,
          }),
          nextCursor: current?.nextCursor ?? null,
        }),
      ),
  });
  const edit = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.updateDirectMessage(id, { content }),
    onSuccess: (message) => {
      queryClient.setQueryData<DirectMessagePage>(
        ['direct-messages', activeConversationId],
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === message.id ? message : item)),
              }
            : current,
      );
      setEditingId(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDirectMessage(id),
    onSuccess: (_result, id) =>
      queryClient.setQueryData<DirectMessagePage>(
        ['direct-messages', activeConversationId],
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === id
                    ? { ...item, content: '', deletedAt: new Date().toISOString() }
                    : item,
                ),
              }
            : current,
      ),
  });
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversationId, messages.at(-1)?.id]);

  if (!activeConversationId) {
    return (
      <section className="flex min-w-0 flex-1 flex-col bg-[#121318]">
        <EmptyState
          title="Choose a direct conversation"
          description="Accept a friend request or message a member to get started."
          icon={<Users size={22} />}
        />
      </section>
    );
  }
  if (history.isLoading || conversations.isLoading) {
    return (
      <section className="grid min-w-0 flex-1 place-items-center bg-[#121318]">
        <Spinner label="Loading direct conversation" />
      </section>
    );
  }
  if (history.isError || conversations.isError || !activeConversation || !partner) {
    const message =
      history.error instanceof Error
        ? history.error.message
        : conversations.error instanceof Error
          ? conversations.error.message
          : 'This direct conversation is unavailable.';
    return (
      <section className="grid min-w-0 flex-1 place-items-center bg-[#121318] p-6">
        <EmptyState
          title="Could not open this conversation"
          description={message}
          icon={<Wifi size={22} />}
        />
      </section>
    );
  }
  const mutationError = send.error ?? edit.error ?? remove.error ?? loadOlder.error;
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[#121318]">
      <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line px-5">
        <Avatar
          name={partner.displayName}
          src={partner.avatarUrl}
          status={partner.status}
          size="sm"
        />
        <div>
          <h1 className="text-sm font-semibold">{partner.displayName}</h1>
          <p className="text-xs text-muted">@{partner.username}</p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl">
          {history.data?.nextCursor && (
            <button
              className="mx-auto mb-4 block rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-white/[.05] hover:text-ink disabled:opacity-50"
              disabled={loadOlder.isPending}
              onClick={() => loadOlder.mutate(history.data.nextCursor ?? '')}
            >
              {loadOlder.isPending ? 'Loading…' : 'Load older messages'}
            </button>
          )}
          {messages.length ? (
            messages.map((message) => (
              <DirectMessageRow
                key={message.id}
                message={message}
                currentUser={currentUser}
                editing={editingId === message.id}
                onStartEdit={() => setEditingId(message.id)}
                onCancelEdit={() => setEditingId(null)}
                onSubmitEdit={(content) => edit.mutate({ id: message.id, content })}
                onDelete={() => remove.mutate(message.id)}
                onInviteAccepted={onInviteAccepted}
              />
            ))
          ) : (
            <EmptyState
              title={`Start a conversation with ${partner.displayName}`}
              description="Say hello when you're ready."
              icon={<Sparkles size={22} />}
            />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="px-5 pb-5">
        <form
          className="mx-auto max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            const content = draft.trim();
            if (!content || send.isPending) return;
            const clientNonce =
              globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
            send.mutate({ content, clientNonce });
            setDraft('');
          }}
        >
          {mutationError && (
            <p role="alert" className="mb-2 text-xs text-coral">
              {mutationError instanceof Error
                ? mutationError.message
                : 'The direct message action failed.'}
            </p>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel px-3 py-2.5 shadow-lg focus-within:border-violet/70">
            <textarea
              aria-label={`Message ${partner.displayName}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={`Message ${partner.displayName}`}
              className="max-h-28 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-ink outline-none placeholder:text-muted"
            />
            <IconButton
              label="Send direct message"
              type="submit"
              disabled={!draft.trim() || send.isPending}
              className="bg-violet text-white hover:bg-violet/90 disabled:opacity-40"
            >
              <Send size={17} />
            </IconButton>
          </div>
        </form>
      </div>
    </section>
  );
}

function DirectMessageRow({
  message,
  currentUser,
  editing,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  onInviteAccepted,
}: {
  message: DirectMessage;
  currentUser: User;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (content: string) => void;
  onDelete: () => void;
  onInviteAccepted: (server: GuildServer) => void;
}) {
  const [value, setValue] = useState(message.content);
  useEffect(() => {
    if (editing) setValue(message.content);
  }, [editing, message.content]);
  if (message.deletedAt) {
    return (
      <div className="flex gap-3 rounded-2xl px-3 py-3 opacity-60">
        <Avatar name={message.author.displayName} src={message.author.avatarUrl} size="sm" />
        <p className="py-1 text-sm italic text-muted">This message was removed.</p>
      </div>
    );
  }
  const ownMessage = message.authorId === currentUser.id;
  return (
    <article className="group relative flex gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/[.03]">
      <Avatar
        name={message.author.displayName}
        src={message.author.avatarUrl}
        status={message.author.status}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{message.author.displayName}</span>
          <span className="text-[11px] text-muted">{formatTime(message.createdAt)}</span>
          {message.updatedAt !== message.createdAt && (
            <span className="text-[10px] text-muted">(edited)</span>
          )}
        </div>
        {editing ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim()) onSubmitEdit(value.trim());
            }}
          >
            <input
              autoFocus
              aria-label="Edit direct message"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="flex-1 rounded-lg border border-violet bg-canvas px-3 py-2 text-sm outline-none"
            />
            <Button type="button" variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
            <Button disabled={!value.trim()} type="submit">
              Save
            </Button>
          </form>
        ) : (
          <InviteMessageContent content={message.content} onInviteAccepted={onInviteAccepted} />
        )}
      </div>
      {ownMessage && !editing && !message.id.startsWith('optimistic-direct-') && (
        <div className="absolute right-3 top-1 flex rounded-lg border border-line bg-panelRaised p-1 opacity-0 shadow-xl transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton label="Edit direct message" className="h-7 w-7" onClick={onStartEdit}>
            <Pencil size={13} />
          </IconButton>
          <IconButton
            label="Delete direct message"
            className="h-7 w-7 text-coral"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      )}
    </article>
  );
}
function LogoutConfirmationDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title="Sign out of Guilda?"
      description="Your session will remain active if you cancel."
      onClose={onClose}
    >
      <div className="space-y-5">
        <p className="text-sm leading-6 text-muted">
          You can sign back in whenever you are ready. Unsaved profile changes are not affected.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            Sign out
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateServerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (server: GuildServer) => void;
}) {
  const [name, setName] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.createServer({ name: name.trim() }),
    onSuccess: (result) => onCreated(result.server),
  });
  return (
    <Modal
      title="Create a new space"
      description="A little home for your people."
      closeDisabled={mutation.isPending}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !mutation.isPending) mutation.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          Space name
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Moonroom"
            className="mt-2 h-12 w-full rounded-xl border border-line bg-canvas px-4 text-sm outline-none focus:border-violet"
          />
        </label>
        {mutation.error && (
          <p className="text-sm text-coral" role="alert">
            {mutation.error instanceof Error ? mutation.error.message : 'Could not create space.'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? 'Creating…' : 'Create space'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function AutomaticJoinDialog({
  invite,
  onClose,
  onRetry,
}: {
  invite: AutomaticInviteState;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <Modal
      title={invite.status === 'pending' ? 'Joining space…' : 'Could not join space'}
      description={
        invite.status === 'pending'
          ? 'We are accepting your invite automatically.'
          : 'The invite could not be accepted.'
      }
      closeDisabled={invite.status === 'pending'}
      onClose={onClose}
    >
      {invite.status === 'pending' ? (
        <div className="flex justify-center py-4">
          <Spinner label="Joining space…" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-coral" role="alert">
            {invite.error}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
function inviteCodeFromInput(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const match = /^\/invite\/([^/]+)\/?$/.exec(url.pathname);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    // Plain invite codes are accepted below.
  }
  return trimmed;
}
function JoinDialog({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (server: GuildServer) => void;
}) {
  const [code, setCode] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.acceptInvite(inviteCodeFromInput(code)),
    onSuccess: (result) => onJoined(result.server),
  });
  return (
    <Modal
      title="Join a space"
      description="Paste an invite code or link from someone you trust."
      closeDisabled={mutation.isPending}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim() && !mutation.isPending) mutation.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          Invite code or link
          <input
            autoFocus
            required
            maxLength={2048}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="MOON-7H2K or https://noxera.online/invite/…"
            className="mt-2 h-12 w-full rounded-xl border border-line bg-canvas px-4 text-sm outline-none focus:border-violet"
          />
        </label>
        {mutation.error && (
          <p className="text-sm text-coral" role="alert">
            {mutation.error instanceof Error
              ? mutation.error.message
              : 'That invite is not available.'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending || !code.trim()}>
            {mutation.isPending ? 'Joining…' : 'Join space'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function InviteDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{
    serverId: string;
    attempt: number;
    promise: Promise<InviteResponse>;
  } | null>(null);
  useEffect(() => {
    if (
      !request.current ||
      request.current.serverId !== serverId ||
      request.current.attempt !== attempt
    ) {
      request.current = {
        serverId,
        attempt,
        promise: api.createInvite(serverId, {}),
      };
    }
    let active = true;
    setInvite(null);
    setLoadError(null);
    setCopied(false);
    setCopyError(null);
    void request.current.promise.then(
      (result) => {
        if (active) setInvite(result);
      },
      (error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Could not make an invite.');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, serverId]);
  const copy = async () => {
    if (!invite || isCopying) return;
    setCopied(false);
    setCopyError(null);
    setIsCopying(true);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(invite.deepLink);
      setCopied(true);
    } catch {
      setCopyError('Could not copy the invite link. Check clipboard permission and try again.');
    } finally {
      setIsCopying(false);
    }
  };
  return (
    <Modal
      title="Invite your people"
      description="Good spaces grow one trusted person at a time."
      onClose={onClose}
    >
      {!invite && !loadError ? (
        <div className="flex justify-center py-8">
          <Spinner label="Making an invite" />
        </div>
      ) : loadError ? (
        <div className="space-y-4">
          <p className="text-sm text-coral" role="alert">
            {loadError}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="button" onClick={() => setAttempt((current) => current + 1)}>
              Try again
            </Button>
          </div>
        </div>
      ) : invite ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-canvas p-4">
            <p className="text-xs text-muted">Invite code</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-widest text-violet">
              {invite.invite.code}
            </p>
          </div>
          {copyError && (
            <p className="text-sm text-coral" role="alert">
              {copyError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="button" onClick={() => void copy()} disabled={isCopying}>
              <Copy size={16} />
              {isCopying ? 'Copying…' : copied ? 'Copied link' : 'Copy invite link'}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
function CreateChannelDialog({
  serverId,
  onClose,
  onCreated,
}: {
  serverId: string;
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'TEXT' | 'VOICE'>('TEXT');
  const mutation = useMutation({
    mutationFn: () =>
      api.createChannel(serverId, { name: name.trim().toLowerCase().replace(/\s+/g, '-'), type }),
    onSuccess: onCreated,
  });
  return (
    <Modal
      title="Create a channel"
      description="Give the next conversation a clear place to land."
      closeDisabled={mutation.isPending}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !mutation.isPending) mutation.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          Channel name
          <input
            required
            autoFocus
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="garden-ideas"
            className="mt-2 h-12 w-full rounded-xl border border-line bg-canvas px-4 text-sm outline-none focus:border-violet"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(['TEXT', 'VOICE'] as const).map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => setType(value)}
              disabled={mutation.isPending}
              className={`rounded-xl border px-3 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${type === value ? 'border-violet bg-violet/10 text-ink' : 'border-line text-muted'}`}
            >
              {value === 'TEXT' ? (
                <Hash size={16} className="mb-2 text-violet" />
              ) : (
                <Volume2 size={16} className="mb-2 text-mint" />
              )}
              <span className="block font-semibold">
                {value === 'TEXT' ? 'Conversation' : 'Hangout'}
              </span>
              <span className="text-xs text-muted">
                {value === 'TEXT' ? 'Messages & files' : 'Voice room'}
              </span>
            </button>
          ))}
        </div>
        {mutation.error && (
          <p className="text-sm text-coral" role="alert">
            {mutation.error instanceof Error ? mutation.error.message : 'Could not create channel.'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? 'Creating…' : 'Create channel'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ModerationDialog({
  serverId,
  members,
  currentUserId,
  ownerId,
  permissions,
  onMemberRemoved,
  onClose,
}: {
  serverId: string;
  members: User[];
  currentUserId: string;
  ownerId: string;
  permissions: number;
  onMemberRemoved: (userId: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const canBan = (permissions & Permission.BAN_MEMBERS) !== 0;
  const canManageReports = (permissions & Permission.MANAGE_SERVER) !== 0;
  const allowedActions = (
    [
      ['KICK', Permission.KICK_MEMBERS],
      ['BAN', Permission.BAN_MEMBERS],
    ] as const
  ).filter(([, permission]) => (permissions & permission) !== 0);
  const eligibleMembers = members.filter(
    (member) => member.id !== currentUserId && member.id !== ownerId,
  );
  const [selected, setSelected] = useState(eligibleMembers[0]?.id ?? '');
  const [action, setAction] = useState<ModerationAction>(allowedActions[0]?.[0] ?? 'KICK');
  const [reason, setReason] = useState('');
  const bans = useQuery({
    queryKey: ['bans', serverId],
    queryFn: () => api.getBans(serverId),
    enabled: canBan,
  });
  const reports = useQuery({
    queryKey: ['reports', serverId],
    queryFn: () => api.getReports(serverId),
    enabled: canManageReports,
  });
  const audit = useQuery({
    queryKey: ['audit-log', serverId],
    queryFn: () => api.getAuditLog(serverId),
    enabled: canManageReports,
  });
  const moderate = useMutation({
    mutationFn: () =>
      api.moderate(serverId, {
        action,
        userId: selected,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      onMemberRemoved(selected);
      void queryClient.invalidateQueries({ queryKey: ['bans', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['audit-log', serverId] });
      onClose();
    },
  });
  const unban = useMutation({
    mutationFn: (userId: string) => api.removeBan(serverId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bans', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['audit-log', serverId] });
    },
  });
  const changeReportStatus = useMutation({
    mutationFn: ({ reportId, status }: { reportId: string; status: ReportStatus }) =>
      api.updateReport(serverId, { reportId, status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reports', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['audit-log', serverId] });
    },
  });
  const error =
    moderate.error ??
    bans.error ??
    unban.error ??
    reports.error ??
    changeReportStatus.error ??
    audit.error;

  return (
    <Modal
      title="Moderation desk"
      description="Manage members, bans, reports and the audit trail within your permissions."
      onClose={onClose}
    >
      <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        {error && (
          <p role="alert" className="rounded-lg bg-coral/10 px-3 py-2 text-sm text-coral">
            {error instanceof Error ? error.message : 'Moderation data is unavailable.'}
          </p>
        )}
        {allowedActions.length > 0 && (
          <form
            className="space-y-4 rounded-xl border border-line p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (selected) moderate.mutate();
            }}
          >
            <h3 className="text-sm font-semibold">Member action</h3>
            {eligibleMembers.length ? (
              <label className="block text-sm font-medium">
                Member
                <select
                  aria-label="Member to moderate"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm"
                >
                  {eligibleMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-sm text-muted">There are no eligible members to moderate.</p>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Action</legend>
              <div className="grid grid-cols-2 gap-2">
                {allowedActions.map(([value]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={action === value}
                    onClick={() => setAction(value)}
                    className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                      action === value
                        ? 'border-coral bg-coral/10 text-coral'
                        : 'border-line text-muted'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm font-medium">
              Reason <span className="text-muted">(optional)</span>
              <textarea
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                className="mt-2 min-h-20 w-full resize-y rounded-xl border border-line bg-canvas p-3 text-sm outline-none focus:border-violet"
              />
            </label>
            <Button variant="danger" className="w-full" disabled={!selected || moderate.isPending}>
              {moderate.isPending ? 'Applying…' : `${action === 'BAN' ? 'Ban' : 'Kick'} member`}
            </Button>
          </form>
        )}
        {canBan && (
          <section className="space-y-2 rounded-xl border border-line p-3" aria-labelledby="bans">
            <h3 id="bans" className="text-sm font-semibold">
              Banned users
            </h3>
            {bans.isLoading ? (
              <Spinner label="Loading bans" />
            ) : bans.data?.items.length ? (
              bans.data.items.map((ban) => (
                <div
                  key={ban.userId}
                  className="flex items-center gap-3 rounded-lg bg-canvas px-3 py-2"
                >
                  <Avatar
                    name={ban.user.displayName}
                    src={ban.user.avatarUrl}
                    status={ban.user.status}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ban.user.displayName}</p>
                    <p className="truncate text-xs text-muted">
                      {ban.reason ?? 'No reason provided'}
                    </p>
                  </div>
                  <Button
                    variant="soft"
                    disabled={unban.isPending}
                    onClick={() => unban.mutate(ban.userId)}
                  >
                    Unban
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No users are banned.</p>
            )}
          </section>
        )}
        {canManageReports && (
          <section
            className="space-y-2 rounded-xl border border-line p-3"
            aria-labelledby="reports"
          >
            <h3 id="reports" className="text-sm font-semibold">
              Reports
            </h3>
            {reports.isLoading ? (
              <Spinner label="Loading reports" />
            ) : reports.data?.items.length ? (
              reports.data.items.map((report) => (
                <div
                  key={report.id}
                  className="flex items-start gap-3 rounded-lg bg-canvas px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{report.reason}</p>
                    <p className="mt-1 text-xs text-muted">
                      {report.messageId
                        ? `Message ${report.messageId}`
                        : report.targetUserId
                          ? `User ${report.targetUserId}`
                          : 'Reported item unavailable'}
                    </p>
                  </div>
                  <select
                    aria-label={`Status for report ${report.id}`}
                    value={report.status}
                    disabled={changeReportStatus.isPending}
                    onChange={(event) =>
                      changeReportStatus.mutate({
                        reportId: report.id,
                        status: event.target.value as ReportStatus,
                      })
                    }
                    className="h-9 rounded-lg border border-line bg-panel px-2 text-xs"
                  >
                    <option value="OPEN">Open</option>
                    <option value="REVIEWING">Reviewing</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="DISMISSED">Dismissed</option>
                  </select>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No reports have been submitted.</p>
            )}
            {reports.data?.nextCursor && (
              <p className="text-xs text-muted">Showing the 50 most recent reports.</p>
            )}
          </section>
        )}
        {canManageReports && (
          <section
            className="space-y-2 rounded-xl border border-line p-3"
            aria-labelledby="audit-log"
          >
            <h3 id="audit-log" className="text-sm font-semibold">
              Audit log
            </h3>
            {audit.isLoading ? (
              <Spinner label="Loading audit log" />
            ) : audit.data?.items.length ? (
              audit.data.items.map((entry) => (
                <div key={entry.id} className="rounded-lg bg-canvas px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{entry.action.replaceAll('_', ' ')}</p>
                    <time className="shrink-0 text-xs text-muted" dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                  </div>
                  {entry.targetId && (
                    <p className="mt-1 truncate text-xs text-muted">
                      {entry.targetType?.toLowerCase() ?? 'target'} {entry.targetId}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No moderation activity has been recorded.</p>
            )}
            {audit.data?.nextCursor && (
              <p className="text-xs text-muted">Showing the 50 most recent audit entries.</p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

function ReportDialog({
  target,
  onClose,
}: {
  target: Omit<CreateReportRequest, 'reason'>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.createReport({ ...target, reason: reason.trim() }),
    onSuccess: onClose,
  });
  return (
    <Modal
      title={target.messageId ? 'Report message' : 'Report user'}
      description="Send this to the server moderation team for review."
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim()) mutation.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          What happened?
          <textarea
            autoFocus
            required
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 min-h-28 w-full resize-y rounded-xl border border-line bg-canvas p-3 text-sm outline-none focus:border-violet"
            placeholder="Describe the behavior that should be reviewed"
          />
        </label>
        {mutation.error && (
          <p role="alert" className="text-sm text-coral">
            {mutation.error instanceof Error ? mutation.error.message : 'The report failed.'}
          </p>
        )}
        <Button className="w-full" disabled={!reason.trim() || mutation.isPending}>
          {mutation.isPending ? 'Sending report…' : 'Submit report'}
        </Button>
      </form>
    </Modal>
  );
}

function RoleManagementDialog({
  serverId,
  ownerId,
  members,
  managerPermissions,
  onClose,
}: {
  serverId: string;
  ownerId: string;
  members: User[];
  managerPermissions: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [permissionMask, setPermissionMask] = useState(0);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [assignmentSaved, setAssignmentSaved] = useState(false);
  const roles = useQuery({
    queryKey: ['roles', serverId],
    queryFn: () => api.getRoles(serverId),
  });
  const memberRoles = useQuery({
    queryKey: ['member-roles', serverId, selectedMemberId],
    queryFn: () => api.getMemberRoles(serverId, selectedMemberId),
    enabled: Boolean(selectedMemberId),
  });
  useEffect(() => {
    if (!selectedMemberId) {
      setSelectedRoleIds([]);
      return;
    }
    if (memberRoles.data) {
      setSelectedRoleIds(memberRoles.data.items.map((role) => role.id));
    }
  }, [memberRoles.data, selectedMemberId]);
  const saveRole = useMutation({
    mutationFn: () => {
      const common = { name: name.trim(), color: color || null };
      if (!editingRole) {
        return api.createRole(serverId, { ...common, permissions: permissionMask });
      }
      return api.updateRole(serverId, editingRole.id, {
        ...common,
        ...(permissionMask !== editingRole.permissions ? { permissions: permissionMask } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles', serverId] });
      setEditingRole(null);
      setName('');
      setColor('');
      setPermissionMask(0);
    },
  });
  const removeRole = useMutation({
    mutationFn: (roleId: string) => api.deleteRole(serverId, roleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['member-roles', serverId] });
    },
  });
  const assignRoles = useMutation({
    mutationFn: () =>
      api.assignMemberRoles(serverId, selectedMemberId, { roleIds: selectedRoleIds }),
    onSuccess: (response) => {
      queryClient.setQueryData(['member-roles', serverId, selectedMemberId], response);
      setAssignmentSaved(true);
    },
  });
  const items = roles.data?.items ?? [];
  const mutableRoles = items.filter((role) => role.name !== '@everyone' && role.name !== 'Owner');
  const permissions = Object.entries(Permission) as Array<[string, number]>;
  const roleNameReserved = name.trim() === '@everyone' || name.trim() === 'Owner';
  const error =
    roles.error ?? memberRoles.error ?? saveRole.error ?? removeRole.error ?? assignRoles.error;

  return (
    <Modal
      title="Roles and permissions"
      description="Create roles and assign them without changing owner authority."
      onClose={onClose}
    >
      <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        {error && (
          <p role="alert" className="rounded-lg bg-coral/10 px-3 py-2 text-sm text-coral">
            {error instanceof Error ? error.message : 'Role management failed.'}
          </p>
        )}
        <section aria-labelledby="role-list-heading">
          <h3 id="role-list-heading" className="mb-2 text-sm font-semibold">
            Server roles
          </h3>
          {roles.isLoading ? (
            <Spinner label="Loading roles" />
          ) : items.length ? (
            <div className="space-y-2">
              {items.map((role) => {
                const immutable = role.name === '@everyone' || role.name === 'Owner';
                return (
                  <div
                    key={role.id}
                    className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-3 py-2"
                  >
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 rounded-full border border-white/20"
                      style={{ backgroundColor: role.color ?? '#727784' }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{role.name}</span>
                    <span className="text-[10px] text-muted">
                      {immutable ? 'protected' : `${role.permissions} mask`}
                    </span>
                    {!immutable && (
                      <>
                        <IconButton
                          label={`Edit ${role.name}`}
                          className="h-7 w-7"
                          disabled={saveRole.isPending || removeRole.isPending}
                          onClick={() => {
                            setEditingRole(role);
                            setName(role.name);
                            setColor(role.color ?? '');
                            setPermissionMask(role.permissions);
                          }}
                        >
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton
                          label={`Delete ${role.name}`}
                          className="h-7 w-7 text-coral"
                          disabled={saveRole.isPending || removeRole.isPending}
                          onClick={() => removeRole.mutate(role.id)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">No roles are available.</p>
          )}
        </section>

        <form
          className="space-y-3 rounded-xl border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !roleNameReserved) saveRole.mutate();
          }}
        >
          <h3 className="text-sm font-semibold">
            {editingRole ? `Edit ${editingRole.name}` : 'Create role'}
          </h3>
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <label className="text-xs font-medium">
              Name
              <input
                required
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none focus:border-violet"
              />
            </label>
            <label className="text-xs font-medium">
              Color
              <input
                aria-label="Role color"
                type="color"
                value={color || '#727784'}
                onChange={(event) => setColor(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-canvas p-1"
              />
            </label>
          </div>
          {roleNameReserved && (
            <p role="alert" className="text-xs text-coral">
              @everyone and Owner are protected role names.
            </p>
          )}
          <fieldset>
            <legend className="mb-2 text-xs font-medium">Permissions</legend>
            <div className="grid grid-cols-2 gap-2">
              {permissions.map(([permissionName, bit]) => (
                <label
                  key={permissionName}
                  className="flex items-center gap-2 rounded-lg bg-white/[.03] px-2 py-2 text-xs"
                >
                  <input
                    disabled={(managerPermissions & bit) === 0}
                    type="checkbox"
                    checked={(permissionMask & bit) !== 0}
                    onChange={(event) =>
                      setPermissionMask((current) =>
                        event.target.checked ? current | bit : current & ~bit,
                      )
                    }
                  />
                  {permissionName.toLowerCase().replaceAll('_', ' ')}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!name.trim() || roleNameReserved || saveRole.isPending}
            >
              {saveRole.isPending ? 'Saving…' : editingRole ? 'Save role' : 'Create role'}
            </Button>
            {editingRole && (
              <button
                type="button"
                className="rounded-xl border border-line px-3 text-sm text-muted"
                onClick={() => {
                  setEditingRole(null);
                  setName('');
                  setColor('');
                  setPermissionMask(0);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <form
          className="space-y-3 rounded-xl border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setAssignmentSaved(false);
            if (selectedMemberId) assignRoles.mutate();
          }}
        >
          <h3 className="text-sm font-semibold">Assign member roles</h3>
          <label className="block text-xs font-medium">
            Member
            <select
              value={selectedMemberId}
              onChange={(event) => {
                setSelectedMemberId(event.target.value);
                setSelectedRoleIds([]);
                setAssignmentSaved(false);
              }}
              className="mt-1 h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm"
            >
              <option value="">Select a member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id} disabled={member.id === ownerId}>
                  {member.displayName}
                  {member.id === ownerId ? ' (owner)' : ''}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={!selectedMemberId}>
            <legend className="mb-2 text-xs font-medium">Complete assigned role set</legend>
            {selectedMemberId && memberRoles.isLoading ? (
              <Spinner label="Loading assigned roles" />
            ) : mutableRoles.length ? (
              <div className="grid grid-cols-2 gap-2">
                {mutableRoles.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-center gap-2 rounded-lg bg-white/[.03] px-2 py-2 text-xs"
                  >
                    <input
                      disabled={
                        (role.permissions & ~managerPermissions) !== 0 &&
                        !memberRoles.data?.items.some((assigned) => assigned.id === role.id)
                      }
                      type="checkbox"
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={(event) =>
                        setSelectedRoleIds((current) =>
                          event.target.checked
                            ? [...current, role.id]
                            : current.filter((roleId) => roleId !== role.id),
                        )
                      }
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">Create a role before assigning one.</p>
            )}
          </fieldset>
          {assignmentSaved && (
            <p role="status" className="text-xs text-mint">
              Member roles updated.
            </p>
          )}
          <Button
            className="w-full"
            disabled={!selectedMemberId || !memberRoles.isSuccess || assignRoles.isPending}
          >
            {assignRoles.isPending ? 'Assigning…' : 'Save member roles'}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
