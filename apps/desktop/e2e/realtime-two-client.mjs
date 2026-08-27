import { io } from 'socket.io-client';

const baseUrl = (process.env.GUILDA_E2E_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const withTimeout = (promise, label, milliseconds = 10_000) =>
  new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error(`${label} timed out`)),
      milliseconds,
    );
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });

class Client {
  constructor(label) {
    this.label = label;
    this.token = null;
    this.user = null;
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
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        `${this.label} ${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`,
      );
    return payload;
  }

  async register() {
    const auth = await this.request('POST', '/auth/register', {
      username: `rt_${this.label}_${suffix.slice(-12)}`,
      displayName: `Realtime ${this.label}`,
      email: `realtime-${this.label}-${suffix}@example.test`,
      password: 'correct horse battery staple',
    });
    this.token = auth.accessToken;
    this.user = auth.user;
  }

  connect() {
    return io(baseUrl, {
      auth: { accessToken: this.token },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });
  }
}

const waitForConnect = (socket, label) =>
  withTimeout(
    new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    }),
    `${label} connection`,
  );

const waitForPresence = (socket, userId, label) =>
  withTimeout(
    new Promise((resolve) => {
      const handler = (event) => {
        if (event.userId !== userId || event.status !== 'ONLINE') return;
        socket.off('presence:update', handler);
        resolve(event);
      };
      socket.on('presence:update', handler);
    }),
    `${label} presence`,
  );

export async function runRealtimeTwoClientScenario() {
  const alice = new Client('alice');
  const bob = new Client('bob');
  await Promise.all([alice.register(), bob.register()]);

  const created = await alice.request('POST', '/servers', { name: `Realtime ${suffix}` });
  const channelId = created.defaultChannel.id;
  const invite = await alice.request('POST', `/servers/${created.server.id}/invites`, {
    maxUses: 1,
  });
  await bob.request('POST', `/invites/${invite.invite.code}/accept`);

  const aliceSocket = alice.connect();
  const bobSocket = bob.connect();
  try {
    const aliceConnected = waitForConnect(aliceSocket, 'Alice');
    const aliceReady = waitForPresence(aliceSocket, alice.user.id, 'Alice');
    aliceSocket.connect();
    await Promise.all([aliceConnected, aliceReady]);

    const bobConnected = waitForConnect(bobSocket, 'Bob');
    const aliceSeesBob = waitForPresence(aliceSocket, bob.user.id, 'Bob');
    bobSocket.connect();
    await Promise.all([bobConnected, aliceSeesBob]);

    const clientNonce = `realtime-${suffix}`;
    const received = withTimeout(
      new Promise((resolve) => aliceSocket.once('message:create', resolve)),
      'Alice message delivery',
    );
    const acknowledged = withTimeout(
      new Promise((resolve) => {
        bobSocket.emit(
          'message:create',
          { channelId, content: 'realtime delivery check', clientNonce },
          resolve,
        );
      }),
      'Bob message acknowledgement',
    );

    const [event, acknowledgement] = await Promise.all([received, acknowledged]);
    if (!event?.message?.id || event.message.id !== acknowledgement?.message?.id)
      throw new Error(`Realtime delivery mismatch: ${JSON.stringify({ event, acknowledgement })}`);
    return {
      serverId: created.server.id,
      channelId,
      messageId: event.message.id,
      clientNonce,
    };
  } finally {
    aliceSocket.close();
    bobSocket.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRealtimeTwoClientScenario()
    .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
