import { Redis } from '@upstash/redis';

let redisClient: Redis | null = null;

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
  // rediss://default:token@hostname:port
  const match = redisUrl.match(/^(?:rediss?:\/\/)(?:[^:]+):([^@]+)@/);
  return match ? match[1] : null;
}

export function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  // Use Vercel KV environment variables
  let url = process.env.REDIS_URL || process.env.KV_REST_API_URL;
  let token = process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

  if (!url) {
    throw new Error(
      'Redis URL not found. Please set REDIS_URL or KV_REST_API_URL environment variable.'
    );
  }

  // Convert rediss:// to https:// if needed
  url = convertRedisUrlToRestUrl(url);

  // Extract token from URL if token env var is not set
  if (!token && (process.env.REDIS_URL || process.env.KV_REST_API_URL)) {
    const extractedToken = extractTokenFromUrl(process.env.REDIS_URL || process.env.KV_REST_API_URL || '');
    if (extractedToken) {
      token = extractedToken;
    }
  }

  if (!token) {
    throw new Error(
      'Redis token not found. Please set KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN, or include token in REDIS_URL.'
    );
  }

  redisClient = new Redis({
    url,
    token,
  });

  return redisClient;
}

