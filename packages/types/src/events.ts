import type {
  Channel,
  DirectConversation,
  DirectMessage,
  Friendship,
  Message,
  PersonalBlock,
  PresenceStatus,
  ServerMember,
} from './entities';

export interface MessageCreateCommand {
  channelId: string;
  content: string;
  replyToId?: string;
  attachmentIds?: string[];
  clientNonce: string;
}

export interface MessageCreatedEvent {
  message: Message;
  clientNonce: string;
  serverId: string;
  channelName: string;
}

export interface MessageUpdatedEvent {
  message: Message;
}

export interface MessageDeletedEvent {
  messageId: string;
  channelId: string;
  deletedAt: string;
}

export interface PresenceUpdatedEvent {
  userId: string;
  status: PresenceStatus;
}

export interface TypingEvent {
  channelId: string;
  userId: string;
}
export interface MemberAuthorizationUpdatedEvent {
  serverId: string;
  userId: string;
  permissions: number;
}

export interface RealtimeError {
  code: string;
  message: string;
}
export interface FriendRequestCreatedEvent {
  friendship: Friendship;
}

export interface FriendshipUpdatedEvent {
  friendship: Friendship;
}

export interface FriendshipDeletedEvent {
  pairKey: string;
  userIds: [string, string];
}

export interface UserBlockUpdatedEvent {
  block: PersonalBlock;
}

export interface UserBlockDeletedEvent {
  blockerId: string;
  blockedId: string;
}

export interface DirectConversationCreatedEvent {
  conversation: DirectConversation;
}

export interface DirectMessageCreatedEvent {
  message: DirectMessage;
  clientNonce: string;
}

export interface DirectMessageUpdatedEvent {
  message: DirectMessage;
}

export interface DirectMessageDeletedEvent {
  messageId: string;
  conversationId: string;
  deletedAt: string;
}

export interface ClientToServerEvents {
  'message:create': (
    payload: MessageCreateCommand,
    acknowledge: (result: MessageCreatedEvent | RealtimeError) => void,
  ) => void;
  'typing:start': (payload: { channelId: string }) => void;
  'typing:stop': (payload: { channelId: string }) => void;
  'presence:update': (payload: { status: PresenceStatus }) => void;
}

export interface ServerToClientEvents {
  'message:create': (payload: MessageCreatedEvent) => void;
  'message:update': (payload: MessageUpdatedEvent) => void;
  'message:delete': (payload: MessageDeletedEvent) => void;
  'channel:create': (payload: Channel) => void;
  'member:join': (payload: ServerMember) => void;
  'member:leave': (payload: { serverId: string; userId: string }) => void;
  'member:update': (payload: MemberAuthorizationUpdatedEvent) => void;
  'presence:update': (payload: PresenceUpdatedEvent) => void;
  'typing:start': (payload: TypingEvent) => void;
  'typing:stop': (payload: TypingEvent) => void;
  'friend-request:create': (payload: FriendRequestCreatedEvent) => void;
  'friendship:update': (payload: FriendshipUpdatedEvent) => void;
  'friendship:delete': (payload: FriendshipDeletedEvent) => void;
  'user-block:update': (payload: UserBlockUpdatedEvent) => void;
  'user-block:delete': (payload: UserBlockDeletedEvent) => void;
  'direct-conversation:create': (payload: DirectConversationCreatedEvent) => void;
  'direct-message:create': (payload: DirectMessageCreatedEvent) => void;
  'direct-message:update': (payload: DirectMessageUpdatedEvent) => void;
  'direct-message:delete': (payload: DirectMessageDeletedEvent) => void;
}

export interface SocketData {
  userId: string;
  sessionId: string;
}
