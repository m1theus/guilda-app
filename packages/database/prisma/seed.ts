import { PrismaClient } from '@prisma/client';
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@guilda/types';
const allPermissions = Object.values(Permission).reduce((bits, permission) => bits | permission, 0);

const prisma = new PrismaClient();
const at = new Date('2026-01-01T00:00:00.000Z');
const passwordHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const ids = {
  alice: '00000000-0000-4000-8000-000000000001',
  bob: '00000000-0000-4000-8000-000000000002',
  carol: '00000000-0000-4000-8000-000000000003',
  server: '00000000-0000-4000-8000-000000000010',
  everyoneRole: '00000000-0000-4000-8000-000000000011',
  moderatorRole: '00000000-0000-4000-8000-000000000012',
  ownerRole: '00000000-0000-4000-8000-000000000013',
  general: '00000000-0000-4000-8000-000000000020',
  lounge: '00000000-0000-4000-8000-000000000021',
  welcomeMessage: '00000000-0000-4000-8000-000000000030',
  conversation: '00000000-0000-4000-8000-000000000040',
  directMessage: '00000000-0000-4000-8000-000000000041',
  auditLog: '00000000-0000-4000-8000-000000000050',
};
const aliceBobPairKey = `${ids.alice}:${ids.bob}`;

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { id: ids.alice },
    update: {},
    create: {
      id: ids.alice,
      username: 'alice',
      displayName: 'Alice',
      email: 'alice@guilda.local',
      passwordHash,
      status: 'ONLINE',
      createdAt: at,
    },
  });
  await prisma.user.upsert({
    where: { id: ids.bob },
    update: {},
    create: {
      id: ids.bob,
      username: 'bob',
      displayName: 'Bob',
      email: 'bob@guilda.local',
      passwordHash,
      status: 'IDLE',
      createdAt: at,
    },
  });
  await prisma.user.upsert({
    where: { id: ids.carol },
    update: {},
    create: {
      id: ids.carol,
      username: 'carol',
      displayName: 'Carol',
      email: 'carol@guilda.local',
      passwordHash,
      status: 'OFFLINE',
      createdAt: at,
    },
  });

  await prisma.server.upsert({
    where: { id: ids.server },
    update: {},
    create: {
      id: ids.server,
      name: 'Guilda Town',
      ownerId: ids.alice,
      createdAt: at,
    },
  });

  for (const userId of [ids.alice, ids.bob, ids.carol]) {
    await prisma.serverMember.upsert({
      where: { serverId_userId: { serverId: ids.server, userId } },
      update: {},
      create: { serverId: ids.server, userId, joinedAt: at },
    });
  }

  await prisma.role.upsert({
    where: { id: ids.everyoneRole },
    update: {},
    create: {
      id: ids.everyoneRole,
      serverId: ids.server,
      name: '@everyone',
      permissions: DEFAULT_EVERYONE_PERMISSIONS,
      position: 0,
      createdAt: at,
    },
  });
  await prisma.role.upsert({
    where: { id: ids.moderatorRole },
    update: {},
    create: {
      id: ids.moderatorRole,
      serverId: ids.server,
      name: 'Moderator',
      permissions:
        Permission.VIEW_CHANNEL |
        Permission.SEND_MESSAGES |
        Permission.MANAGE_MESSAGES |
        Permission.KICK_MEMBERS,
      position: 1,
      createdAt: at,
    },
  });
  await prisma.role.upsert({
    where: { id: ids.ownerRole },
    update: {},
    create: {
      id: ids.ownerRole,
      serverId: ids.server,
      name: 'Owner',
      permissions: allPermissions,
      position: 2,
      createdAt: at,
    },
  });
  await prisma.serverMemberRole.upsert({
    where: {
      serverId_userId_roleId: { serverId: ids.server, userId: ids.alice, roleId: ids.everyoneRole },
    },
    update: {},
    create: { serverId: ids.server, userId: ids.alice, roleId: ids.everyoneRole },
  });
  await prisma.serverMemberRole.upsert({
    where: {
      serverId_userId_roleId: { serverId: ids.server, userId: ids.bob, roleId: ids.everyoneRole },
    },
    update: {},
    create: { serverId: ids.server, userId: ids.bob, roleId: ids.everyoneRole },
  });
  await prisma.serverMemberRole.upsert({
    where: {
      serverId_userId_roleId: {
        serverId: ids.server,
        userId: ids.alice,
        roleId: ids.moderatorRole,
      },
    },
    update: {},
    create: { serverId: ids.server, userId: ids.alice, roleId: ids.moderatorRole },
  });
  await prisma.serverMemberRole.upsert({
    where: {
      serverId_userId_roleId: { serverId: ids.server, userId: ids.alice, roleId: ids.ownerRole },
    },
    update: {},
    create: { serverId: ids.server, userId: ids.alice, roleId: ids.ownerRole },
  });

  await prisma.channel.upsert({
    where: { id: ids.general },
    update: {},
    create: {
      id: ids.general,
      serverId: ids.server,
      name: 'general',
      type: 'TEXT',
      position: 0,
      createdAt: at,
    },
  });
  await prisma.channel.upsert({
    where: { id: ids.lounge },
    update: {},
    create: {
      id: ids.lounge,
      serverId: ids.server,
      name: 'Lounge',
      type: 'VOICE',
      position: 1,
      createdAt: at,
    },
  });
  await prisma.message.upsert({
    where: { id: ids.welcomeMessage },
    update: {},
    create: {
      id: ids.welcomeMessage,
      channelId: ids.general,
      authorId: ids.alice,
      content: 'Welcome to Guilda Town!',
      clientNonce: 'seed-welcome-001',
      createdAt: at,
    },
  });
  await prisma.invite.upsert({
    where: { code: 'GUILDATOWN' },
    update: {},
    create: {
      code: 'GUILDATOWN',
      serverId: ids.server,
      createdById: ids.alice,
      maxUses: 100,
      createdAt: at,
    },
  });
  await prisma.friendship.upsert({
    where: { pairKey: aliceBobPairKey },
    update: {},
    create: {
      pairKey: aliceBobPairKey,
      requesterId: ids.alice,
      addresseeId: ids.bob,
      status: 'ACCEPTED',
      requestedAt: at,
      respondedAt: at,
    },
  });
  await prisma.directConversation.upsert({
    where: { id: ids.conversation },
    update: {},
    create: {
      id: ids.conversation,
      pairKey: aliceBobPairKey,
      createdById: ids.alice,
      createdAt: at,
    },
  });
  for (const userId of [ids.alice, ids.bob]) {
    await prisma.directConversationMember.upsert({
      where: { conversationId_userId: { conversationId: ids.conversation, userId } },
      update: {},
      create: { conversationId: ids.conversation, userId, joinedAt: at },
    });
  }
  await prisma.directMessage.upsert({
    where: { id: ids.directMessage },
    update: {},
    create: {
      id: ids.directMessage,
      conversationId: ids.conversation,
      authorId: ids.alice,
      content: 'Hi Bob!',
      clientNonce: 'seed-direct-001',
      createdAt: at,
    },
  });
  await prisma.messageReaction.upsert({
    where: {
      messageId_userId_emoji: { messageId: ids.welcomeMessage, userId: ids.bob, emoji: '👋' },
    },
    update: {},
    create: { messageId: ids.welcomeMessage, userId: ids.bob, emoji: '👋', createdAt: at },
  });
  await prisma.readState.upsert({
    where: { userId_channelId: { userId: ids.bob, channelId: ids.general } },
    update: { lastReadMessageId: ids.welcomeMessage },
    create: {
      userId: ids.bob,
      channelId: ids.general,
      lastReadMessageId: ids.welcomeMessage,
      updatedAt: at,
    },
  });
  await prisma.auditLog.upsert({
    where: { id: ids.auditLog },
    update: {},
    create: {
      id: ids.auditLog,
      serverId: ids.server,
      actorId: ids.alice,
      action: 'SERVER_CREATED',
      targetType: 'Server',
      targetId: ids.server,
      metadata: { source: 'seed' },
      createdAt: at,
    },
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
