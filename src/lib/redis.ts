import { Redis } from '@upstash/redis';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  // Use Vercel KV environment variables
  const url = process.env.REDIS_URL || process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Redis credentials not found. Please set REDIS_URL (or KV_REST_API_URL) and KV_REST_API_TOKEN (or KV_REST_API_READ_ONLY_TOKEN) environment variables.'
    );
  }

  redisClient = new Redis({
    url,
    token,
  });

  return redisClient;
}

