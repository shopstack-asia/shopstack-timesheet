import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

/**
 * Guard: every enforceRateLimit call site under API routes must fail closed
 * (omit failOpen or set failOpen: false). failOpen: true is forbidden here.
 */
describe('rate-limit endpoint failOpen matrix', () => {
  it('no API route opts into failOpen: true', () => {
    const root = join(process.cwd(), 'src/app/api');
    const files = walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('enforceRateLimit')) continue;
      if (/failOpen\s*:\s*true/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every enforceRateLimit call site sets failOpen: false', () => {
    const root = join(process.cwd(), 'src/app/api');
    const files = walk(root).filter((f) => {
      const text = readFileSync(f, 'utf8');
      return text.includes('enforceRateLimit');
    });
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const calls = text.match(/enforceRateLimit\(/g) || [];
      const explicit = text.match(/failOpen\s*:\s*false/g) || [];
      expect(explicit.length, file).toBeGreaterThanOrEqual(calls.length);
    }
  });
});
