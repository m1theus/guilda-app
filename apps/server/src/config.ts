import { z } from 'zod';
function isExactOrigin(value: string): boolean {
  if (value.includes('*')) return false;
  try {
    const url = new URL(value);
    return (
      url.hostname.length > 0 &&
      (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tauri:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '' || url.pathname === '/') &&
      value === `${url.protocol}//${url.host}`
    );
  } catch {
    return false;
  }
}
const corsOrigins = z.string().transform((value, context) => {
  const origins = [
    ...new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
  if (origins.length === 0 || origins.some((origin) => !isExactOrigin(origin))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'CORS_ORIGIN must contain comma-separated exact origins without wildcards',
    });
    return z.NEVER;
  }
  return origins;
});

const ACCESS_TOKEN_TTL_SECONDS = 2 * 24 * 60 * 60;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: corsOrigins.default(
    'http://127.0.0.1:1420,http://localhost:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost',
  ),
  JWT_SECRET: z.string().min(32),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BROWSER_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  LIVEKIT_URL: z.string().url().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().min(1).default('devkey'),
  LIVEKIT_API_SECRET: z.string().min(1).default('devsecret-change-me'),
});

export type Config = z.infer<typeof envSchema> & { ACCESS_TOKEN_TTL_SECONDS: number };
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.message}`);
  return { ...result.data, ACCESS_TOKEN_TTL_SECONDS };
}
