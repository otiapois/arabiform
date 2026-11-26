import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));

function withBundle(site: string | undefined, check: (dist: string, verify: (...args: string[]) => SpawnSyncReturns<string>) => void) {
  const cache = process.platform === 'win32' ? 'D:\\cache\\arabiform\\tmp' : tmpdir();
  mkdirSync(cache, { recursive: true });
  const parent = realpathSync(cache);
  const temporary = mkdtempSync(join(parent, 'release-bundle-'));
  function run(script: string, args: string[] = []) {
    const env = { ...process.env };
    delete env.SITE_URL;
    if (site) env.SITE_URL = site;
    return spawnSync(process.execPath, [join(temporary, script), ...args], { encoding: 'utf8', cwd: temporary, env });
  }
  try {
    const files = [
      'scripts/prerender.mjs', 'scripts/verify-release-bundle.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
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
    const prerender = run('scripts/prerender.mjs');
    expect(prerender.status, prerender.stderr).toBe(0);
    check(dist, (...args) => run('scripts/verify-release-bundle.mjs', args));
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
    const entry = join(dist, 'assets/index-test.js');
    writeFileSync(entry, ' '.repeat(300_000));
    const oversized = verify();
    expect(oversized.status).toBe(1);
    expect(oversized.stderr).toContain('entry JS exceeds its budget');
    writeFileSync(entry, '// synthetic entry');
    writeFileSync(join(dist, 'extra.html'), '<title>Extra</title>');
    const extra = verify();
    expect(extra.status).toBe(1);
    expect(extra.stderr).toContain('exactly the five');
  });
});

it('accepts a strict origin and rejects a local hostname leak in any release metadata file', () => {
  withBundle('https://release-check.invalid', (dist, verify) => {
    const strict = verify('--strict-origin');
    expect(strict.status, strict.stderr).toBe(0);
    for (const file of ['ar/pdf-mail-merge/index.html', 'sitemap.xml', 'robots.txt']) {
      const path = join(dist, file);
      const original = readFileSync(path, 'utf8');
      const comment = file === 'robots.txt' ? '# https://arabiform.example' : '<!-- https://arabiform.example -->';
      writeFileSync(path, original + '\n' + comment);
      const leaked = verify('--strict-origin');
      expect(leaked.status).toBe(1);
      expect(leaked.stderr).toContain('dist/' + file + ' contains the arabiform.example placeholder');
      writeFileSync(path, original);
    }
  });
}, 15_000);
