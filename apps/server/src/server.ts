import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PrismaRepository } from './database.js';

const config = loadConfig();
const repository = new PrismaRepository();
const app = await buildApp({ repo: repository, config });
const close = async () => {
  await app.close();
  await repository.close?.();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
await app.listen({ host: config.HOST, port: config.PORT });
