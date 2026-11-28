import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));

function withBundle(site: string | undefined, check: (dist: string, verify: (args?: string[], origin?: string) => SpawnSyncReturns<string>) => void) {
  const configuredTemp = tmpdir();
  const cache = process.platform === 'win32' && parse(configuredTemp).root.toUpperCase() !== 'D:\\'
    ? 'D:\\cache\\arabiform\\tmp' : configuredTemp;
  mkdirSync(cache, { recursive: true });
  const parent = realpathSync(cache);
  const temporary = mkdtempSync(join(parent, 'release-bundle-'));
  function run(script: string, args: string[] = [], origin?: string) {
    const env = { ...process.env };
    delete env.SITE_URL;
    if (origin !== undefined) env.SITE_URL = origin;
    return spawnSync(process.execPath, [join(temporary, script), ...args], { encoding: 'utf8', cwd: temporary, env });
  }
  try {
    const files = [
      'scripts/prerender.mjs', 'scripts/verify-release-bundle.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
      'src/web/workbench-labels.json',
      'public/fonts/NotoNaskhArabic-OFL.txt', 'public/fonts/NotoSans-OFL.txt', '.github/workflows/ci.yml',
    ];
    for (const file of files) {
      const destination = join(temporary, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(project, file), destination);
    }
    const dist = join(temporary, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    const index = readFileSync(join(project, 'index.html'), 'utf8');
    writeFileSync(join(dist, 'index.html'), index.replace('/src/web/main.tsx', '/assets/index-test.js'));
    writeFileSync(join(dist, 'assets/index-test.js'), '// synthetic entry');
    const prerender = run('scripts/prerender.mjs', [], site);
    expect(prerender.status, prerender.stderr).toBe(0);
    check(dist, (args, origin) => run('scripts/verify-release-bundle.mjs', args, origin));
  } finally {
    const resolved = realpathSync(temporary);
    if (resolved !== temporary || dirname(resolved) !== parent) throw new Error('Unexpected test directory');
    rmSync(resolved, { recursive: true, force: true });
  }
}

it('accepts the default local build and rejects an extra HTML page', () => {
  withBundle(undefined, (dist, verify) => {
    const local = verify();
    expect(local.status, local.stderr).toBe(0);
    expect(local.stdout).toContain('https://arabiform.example');

    const headersPath = join(dist, '_headers');
    const headers = readFileSync(headersPath, 'utf8');
    writeFileSync(headersPath, headers.replace("connect-src 'none'", "connect-src 'self'"));
    const relaxed = verify();
    expect(relaxed.status).toBe(1);
    expect(relaxed.stderr).toContain("requires connect-src 'none'");
    writeFileSync(headersPath, headers.replace("default-src 'self'", "default-src *"));
    const permissiveDefault = verify();
    expect(permissiveDefault.status).toBe(1);
    expect(permissiveDefault.stderr).toContain("requires default-src 'self'");
    writeFileSync(headersPath, headers);

    writeFileSync(join(dist, 'extra.html'), '<title>Extra</title>');
    const extra = verify();
    expect(extra.status).toBe(1);
    expect(extra.stderr).toContain('exactly the five');
  });
}, 15_000);

it('enforces the raw and gzip entry limits independently', () => {
  withBundle(undefined, (dist, verify) => {
    const entry = join(dist, 'assets/index-test.js');
    writeFileSync(entry, ' '.repeat(267_999));
    const belowRawLimit = verify();
    expect(belowRawLimit.status, belowRawLimit.stderr).toBe(0);
    writeFileSync(entry, ' '.repeat(268_000));
    const atRawLimit = verify();
    expect(atRawLimit.status).toBe(1);
    expect(atRawLimit.stderr).toContain('entry JS exceeds its budget: 268000 raw');

    const lowCompressibility = createHash('shake256', { outputLength: 83_500 }).update('release budget fixture').digest();
    const gzipOverhead = gzipSync(lowCompressibility).length - lowCompressibility.length;
    const rawAtGzipLimit = 83_500 - gzipOverhead;
    writeFileSync(entry, lowCompressibility.subarray(0, rawAtGzipLimit - 1));
    const belowGzipLimit = verify();
    expect(belowGzipLimit.status, belowGzipLimit.stderr).toBe(0);
    expect(belowGzipLimit.stdout).toContain(' / 83499 gzip bytes');
    writeFileSync(entry, lowCompressibility.subarray(0, rawAtGzipLimit));
    const atGzipLimit = verify();
    expect(atGzipLimit.status).toBe(1);
    expect(atGzipLimit.stderr).toContain('entry JS exceeds its budget: ' + rawAtGzipLimit + ' raw / 83500 gzip bytes');
  });
}, 15_000);

it('accepts either strict origin input and rejects mismatches or placeholder metadata', () => {
  const origin = 'https://release-check.invalid';
  withBundle(origin, (dist, verify) => {
    const strict = verify(['--strict-origin'], origin);
    expect(strict.status, strict.stderr).toBe(0);

    const positional = verify(['--strict-origin', origin]);
    expect(positional.status, positional.stderr).toBe(0);
    expect(positional.stdout).toContain(origin + ' (strict origin)');

    const matching = verify(['--strict-origin', origin], origin + '/');
    expect(matching.status, matching.stderr).toBe(0);

    const invalidInputs = [
      { args: ['--strict-origin'], message: 'requires SITE_URL or an explicit origin' },
      { args: ['--strict-origin', origin + '/guide/..'], message: 'must be an HTTP(S) origin' },
      { args: ['--strict-origin', origin + '\n'], message: 'must be an HTTP(S) origin' },
      { args: ['--strict-origin', 'https://arabiform.example'], message: 'requires a non-placeholder origin' },
      { args: ['--strict-origin', origin], env: 'https://other-release.invalid', message: 'does not match SITE_URL' },
      { args: ['--strict-origin', 'https://other-release.invalid'], message: 'has an unexpected canonical' },
    ];
    for (const { args, env, message } of invalidInputs) {
      const result = verify(args, env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
    }

    for (const file of ['ar/pdf-mail-merge/index.html', 'sitemap.xml', 'robots.txt']) {
      const path = join(dist, file);
      const original = readFileSync(path, 'utf8');
      const comment = file === 'robots.txt' ? '# https://arabiform.example' : '<!-- https://arabiform.example -->';
      writeFileSync(path, original + '\n' + comment);
      const leaked = verify(['--strict-origin', origin]);
      expect(leaked.status).toBe(1);
      expect(leaked.stderr).toContain('dist/' + file + ' contains the arabiform.example placeholder');
      writeFileSync(path, original);
    }
  });
}, 30_000);
