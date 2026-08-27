import { TextDecoder, TextEncoder } from 'node:util';

const baseUrl = (process.env.GUILDA_E2E_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

class Client {
  constructor(label) {
    this.label = label;
    this.token = null;
  }

  async request(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok)
      throw new Error(
        `${this.label} ${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`,
      );
    return payload;
  }

  async register() {
    const payload = await this.request('POST', '/auth/register', {
      username: `e2e_${this.label}_${suffix}`,
      displayName: `E2E ${this.label}`,
      email: `e2e-${this.label}-${suffix}@example.test`,
      password: 'correct horse battery staple',
    });
    this.token = payload.accessToken;
    return payload;
  }

  async expectStatus(status, method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status !== status) {
      throw new Error(
        `${this.label} ${method} ${path} -> expected ${status}, received ${response.status}: ${await response.text()}`,
      );
    }
  }
}

export async function runTwoClientScenario() {
  const alice = new Client('alice');
  const bob = new Client('bob');
  const aliceAuth = await alice.register();
  const bobAuth = await bob.register();

  const created = await alice.request('POST', '/servers', { name: `E2E ${suffix}` });
  const serverId = created.server.id;
  const defaultChannelId = created.defaultChannel.id;
  const channel = await alice.request('POST', `/servers/${serverId}/channels`, {
    name: 'e2e-chat',
    type: 'TEXT',
  });
  const voiceChannel = await alice.request('POST', `/servers/${serverId}/channels`, {
    name: 'e2e-voice',
    type: 'VOICE',
  });
  const invite = await alice.request('POST', `/servers/${serverId}/invites`, { maxUses: 1 });
  await bob.request('POST', `/invites/${invite.invite.code}/accept`);
  const [aliceMedia, bobMedia] = await Promise.all([
    alice.request('POST', '/media/token', { channelId: voiceChannel.id }),
    bob.request('POST', '/media/token', { channelId: voiceChannel.id }),
  ]);
  if (!aliceMedia.token || aliceMedia.roomName !== bobMedia.roomName)
    throw new Error('LiveKit token issuance did not target one shared voice room');

  const clientNonce = `nonce-${suffix}`;
  const sent = await bob.request('POST', `/channels/${defaultChannelId}/messages`, {
    content: 'two-client delivery check',
    clientNonce,
  });
  const history = await alice.request('GET', `/channels/${defaultChannelId}/messages?limit=100`);
  const received = history.items?.find(
    (message) => message.id === sent.id || message.clientNonce === clientNonce,
  );
  if (!received) throw new Error('Alice did not receive Bob message in channel history');

  const friendship = await alice.request('POST', '/friend-requests', {
    addresseeId: bobAuth.user.id,
  });
  await bob.request('POST', `/friend-requests/${aliceAuth.user.id}/accept`);
  if (friendship.requesterId !== aliceAuth.user.id)
    throw new Error('Friend request requester was not persisted');
  const conversation = await alice.request('POST', '/direct-conversations', {
    otherUserId: bobAuth.user.id,
  });
  const directNonce = `direct-${suffix}`;
  const directMessage = await alice.request(
    'POST',
    `/direct-conversations/${conversation.id}/messages`,
    { content: 'direct delivery check', clientNonce: directNonce },
  );
  const directHistory = await bob.request(
    'GET',
    `/direct-conversations/${conversation.id}/messages?limit=100`,
  );
  if (!directHistory.items?.some((message) => message.id === directMessage.id))
    throw new Error('Bob did not receive Alice direct message');
  await bob.request('PUT', `/users/${aliceAuth.user.id}/block`);
  await alice.expectStatus(403, 'POST', `/direct-conversations/${conversation.id}/messages`, {
    content: 'blocked delivery must fail',
    clientNonce: `blocked-${suffix}`,
  });
  await bob.request('DELETE', `/users/${aliceAuth.user.id}/block`);

  const bytes = new TextEncoder().encode(`Guilda attachment ${suffix}`);
  const upload = await alice.request('POST', `/channels/${defaultChannelId}/attachments`, {
    filename: 'guilda-e2e.txt',
    mimeType: 'text/plain',
    size: bytes.byteLength,
  });
  const uploaded = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: bytes,
  });
  if (!uploaded.ok) throw new Error(`Object upload failed with ${uploaded.status}`);
  const completed = await alice.request('POST', `/attachments/${upload.attachmentId}/complete`);
  const attachmentMessage = await alice.request('POST', `/channels/${defaultChannelId}/messages`, {
    content: '',
    attachmentIds: [completed.attachment.id],
    clientNonce: `attachment-${suffix}`,
  });
  if (attachmentMessage.attachments?.[0]?.id !== completed.attachment.id)
    throw new Error('Completed attachment was not atomically claimed by the message');
  const downloaded = await alice.request('GET', `/attachments/${completed.attachment.id}/content`);
  if (downloaded !== new TextDecoder().decode(bytes))
    throw new Error('Downloaded attachment bytes did not match the upload');

  return {
    serverId,
    channelId: channel.id,
    voiceChannelId: voiceChannel.id,
    mediaRoomName: aliceMedia.roomName,
    messageId: sent.id,
    clientNonce,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTwoClientScenario()
    .then((result) => {
      console.log(JSON.stringify({ ok: true, ...result }));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
