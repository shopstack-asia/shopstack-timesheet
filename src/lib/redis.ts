import { Redis as UpstashRedis } from '@upstash/redis';
import Redis from 'ioredis';

type RedisClient = UpstashRedis | Redis;

// Wrapper interface to make both clients compatible
interface RedisAdapter {
  get<T>(key: string): Promise<T | null>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

// Upstash Redis adapter
class UpstashRedisAdapter implements RedisAdapter {
  constructor(private client: UpstashRedis) {}

  async get<T>(key: string): Promise<T | null> {
    const result = await this.client.get<T>(key);
    return result ?? null;
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}

// Local Redis (ioredis) adapter
class LocalRedisAdapter implements RedisAdapter {
  constructor(private client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const result = await this.client.get(key);
    if (!result) return null;
    try {
      // Try to parse as JSON first (most values are JSON.stringify'd)
      return JSON.parse(result) as T;
    } catch {
      // If not JSON, return as string (for backward compatibility)
      return result as unknown as T;
    }
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    // value is already a string (JSON.stringify'd by caller)
    await this.client.setex(key, seconds, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}

let redisClient: RedisAdapter | null = null;

/**
 * Check if Redis URL is for local Redis
 */
function isLocalRedis(redisUrl: string): boolean {
  const localPatterns = [
    /^redis:\/\/127\.0\.0\.1/,
    /^redis:\/\/localhost/,
    /^redis:\/\/0\.0\.0\.0/,
    /^redis:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)/,
  ];
  
  return localPatterns.some(pattern => pattern.test(redisUrl));
}

/**
 * Parse Redis URL to extract connection details
 */
function parseRedisUrl(redisUrl: string): {
  host: string;
  port: number;
  db?: number;
  password?: string;
} {
  // Format: redis://[password@]host:port[/db]
  const match = redisUrl.match(/^redis:\/\/(?:([^:@]+):([^@]+)@)?([^:\/]+)(?::(\d+))?(?:\/(\d+))?/);
  
  if (!match) {
    throw new Error(`Invalid Redis URL format: ${redisUrl}`);
  }

  const [, username, password, host, portStr, dbStr] = match;
  
  return {
    host: host || '127.0.0.1',
    port: portStr ? parseInt(portStr, 10) : 6379,
    db: dbStr ? parseInt(dbStr, 10) : undefined,
    password: password || undefined,
  };
}

/**
 * Convert rediss:// URL to https:// REST API URL
 */
function convertRedisUrlToRestUrl(redisUrl: string): string {
  // If already https://, return as is
  if (redisUrl.startsWith('https://')) {
    return redisUrl;
  }

  // Convert rediss:// or redis:// to https://
  if (redisUrl.startsWith('rediss://') || redisUrl.startsWith('redis://')) {
    // Extract hostname from rediss://default:password@hostname:port
    const urlMatch = redisUrl.match(/^(?:rediss?:\/\/)(?:[^@]+@)?([^:]+)(?::\d+)?/);
    if (urlMatch && urlMatch[1]) {
      return `https://${urlMatch[1]}`;
    }
  }

  // If no conversion needed, return original
  return redisUrl;
}

/**
 * Extract token from rediss:// URL if token env var is not set
 */
function extractTokenFromUrl(redisUrl: string): string | null {
  // Support multiple formats:
  // 1. rediss://default:token@hostname:port
  // 2. rediss://:token@hostname:port (no username)
  // 3. redis://default:token@hostname:port
  
  // Try format: protocol://username:token@hostname
  let match = redisUrl.match(/^(?:rediss?:\/\/)(?:[^:]*):([^@]+)@/);
  if (match && match[1]) {
    return match[1];
  }
  
  // Try format: protocol://token@hostname (no username)
  match = redisUrl.match(/^(?:rediss?:\/\/)([^@]+)@/);
  if (match && match[1] && !match[1].includes(':')) {
    // If no colon, it might be a token
    return match[1];
  }
  
  return null;
}

export function getRedisClient(): RedisAdapter {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || process.env.KV_REST_API_URL;

  if (!redisUrl) {
    throw new Error(
      'Redis URL not found. Please set REDIS_URL or KV_REST_API_URL environment variable.'
    );
  }

  // Check if it's local Redis
  if (isLocalRedis(redisUrl)) {
    try {
      const config = parseRedisUrl(redisUrl);
      const client = new Redis({
        host: config.host,
        port: config.port,
        db: config.db,
        password: config.password,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      client.on('error', (err) => {
        console.error('[Redis] Local Redis connection error:', err);
      });

      client.on('connect', () => {
        console.log('[Redis] Connected to local Redis');
      });

      redisClient = new LocalRedisAdapter(client);
      return redisClient;
    } catch (error) {
      throw new Error(
        `Failed to connect to local Redis: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Otherwise, use Upstash Redis (REST API)
  let token = process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

  // Extract token from REDIS_URL if token env var is not set
  if (!token) {
    const extractedToken = extractTokenFromUrl(redisUrl);
    if (extractedToken) {
      token = extractedToken;
    }
  }

  // Convert rediss:// to https:// if needed
  let url = convertRedisUrlToRestUrl(redisUrl);

  // If still no token, provide helpful error message based on URL format
  if (!token) {
    const isHttpsUrl = redisUrl.startsWith('https://');
    const isRedisUrl = redisUrl.startsWith('rediss://') || redisUrl.startsWith('redis://');
    
    if (isHttpsUrl) {
      throw new Error(
        'Redis token not found. Since you are using REDIS_URL with https:// format, ' +
        'you need to set KV_REST_API_TOKEN or KV_REST_API_READ_ONLY_TOKEN environment variable separately.\n\n' +
        'Example:\n' +
        'REDIS_URL=https://your-host.upstash.io\n' +
        'KV_REST_API_TOKEN=your-token-here'
      );
    } else if (isRedisUrl) {
      throw new Error(
        'Redis token not found in REDIS_URL. Please include the token in the URL format:\n\n' +
        'REDIS_URL=rediss://default:your-token@your-host.upstash.io:6379\n\n' +
        'Or set KV_REST_API_TOKEN or KV_REST_API_READ_ONLY_TOKEN environment variable separately.'
      );
    } else {
      throw new Error(
        'Redis token not found. Please set one of the following:\n' +
        '1. KV_REST_API_TOKEN or KV_REST_API_READ_ONLY_TOKEN environment variable\n' +
        '2. Include token in REDIS_URL: rediss://default:token@hostname:port\n' +
        '3. Use KV_REST_API_URL=https://hostname with KV_REST_API_TOKEN=token'
      );
    }
  }

  const client = new UpstashRedis({
    url,
    token,
  });

  redisClient = new UpstashRedisAdapter(client);
  return redisClient;
}
