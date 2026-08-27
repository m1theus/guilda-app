import type { Message } from '@guilda/types';
import type { RealtimeDatabase, RealtimeMembership } from './contracts.js';
import type { MemberRecord, Repository } from '../repository.js';

const membershipContract = (membership: MemberRecord | null): RealtimeMembership | null =>
  membership
    ? {
        serverId: membership.serverId,
        userId: membership.userId,
        permissions: membership.permissions,
      }
    : null;

/** Maps the PostgreSQL-backed server repository to the realtime persistence boundary. */
export const createRealtimeDatabase = (repository: Repository): RealtimeDatabase => ({
  async listMemberships(userId) {
    const servers = await repository.listServersForUser(userId);
    const memberships = await Promise.all(
      servers.map((server) => repository.getMembership(server.id, userId)),
    );
    return memberships.flatMap((membership) => {
      const mapped = membershipContract(membership);
      return mapped ? [mapped] : [];
    });
  },
  async getMembership(serverId, userId) {
    return membershipContract(await repository.getMembership(serverId, userId));
  },
  async listChannels(serverId, userId) {
    const snapshot = await repository.getSnapshot(serverId, userId);
    return snapshot.channels.map((channel) => ({
      id: channel.id,
      serverId: channel.serverId,
      name: channel.name,
    }));
  },
  async getChannel(channelId) {
    const channel = await repository.getChannel(channelId);
    return channel ? { id: channel.id, serverId: channel.serverId, name: channel.name } : null;
  },
  getMessage: (messageId): Promise<Message | null> => repository.getMessage(messageId),
  async createMessage(input) {
    return repository.createMessage({
      channelId: input.channelId,
      authorId: input.authorId,
      content: input.content,
      replyToId: input.replyToId ?? null,
      attachmentIds: [...(input.attachmentIds ?? [])],
      clientNonce: input.clientNonce,
    });
  },
  async updateMessage(input) {
    return repository.updateMessage(input.messageId, input.content);
  },
  async deleteMessage(input) {
    const existing = await repository.getMessage(input.messageId);
    if (!existing) return null;
    await repository.deleteMessage(input.messageId);
    return {
      messageId: input.messageId,
      channelId: existing.channelId,
      deletedAt: input.deletedAt,
    };
  },
});
