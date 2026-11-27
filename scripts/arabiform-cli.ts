import { lstat, mkdir, open, readFile, readdir, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { CLI_USAGE, CliUsageError, isSafeLocalComponent, isSafeLocalPath, parseCliArgs, type CliCommand } from '../src/core/cli/arguments';
import { dispatchCli, type CliJob } from '../src/core/cli/dispatch';

function nativePath(path: string) {
  if (!isSafeLocalPath(path) || process.platform !== 'win32' && (path.includes('\\') || /^[A-Za-z]:/.test(path))) {
    throw new CliUsageError('Unsafe local path: ' + path);
  }
  return resolve(path);
}

async function localInput(path: string, kind: 'file' | 'directory') {
  const actual = await realpath(nativePath(path));
  // Resolve explicitly supplied input links and reject UNC and device targets.
  // A filesystem root can be an input directory via "." at that root.
  if (actual !== parse(actual).root || /^[\\/]{2}/.test(actual)) nativePath(actual);
  const info = await stat(actual);
  if (kind === 'file' ? !info.isFile() : !info.isDirectory()) throw new Error('Expected a regular ' + kind + ': ' + path);
  return actual;
}

async function readLocal(path: string) {
  return readFile(await localInput(path, 'file'));
}

async function readPdfFiles(paths: readonly string[]) {
  const inputs = [];
  for (const path of paths) {
    const logicalPath = nativePath(path);
    inputs.push({ filename: basename(logicalPath), parentFolder: basename(dirname(logicalPath)), bytes: await readLocal(path) });
  }
  return inputs;
}

async function loadFonts() {
  const [arabic, latin] = await Promise.all([
    readFile(new URL('../public/fonts/NotoNaskhArabic-Regular.ttf', import.meta.url)),
    readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url)),
  ]);
  return { arabic, latin };
}

async function loadJob(command: Exclude<CliCommand, { mode: 'help' }>, date: string): Promise<{ job: CliJob; outDir?: string }> {
  if (command.mode === 'packet') {
    const { outDir, templates, roster, mappings, sheet, groupBy, cover } = command;
    nativePath(outDir);
    const [templateFiles, rosterBytes, fonts, mappingsBytes] = await Promise.all([
      readPdfFiles(templates), readLocal(roster), loadFonts(), mappings && readLocal(mappings),
    ]);
    return { outDir, job: { mode: 'packet',
      input: { templates: templateFiles.map(({ filename, bytes }) => ({ name: filename, bytes })),
        roster: { name: basename(roster), bytes: rosterBytes, sheetName: sheet },
        fonts, groupByColumn: groupBy, includeCover: cover, localDate: date },
      mappingsJson: mappingsBytes ? new TextDecoder('utf-8', { fatal: true }).decode(mappingsBytes) : undefined,
    } };
  }
  if (command.mode === 'preflight' || command.mode === 'fill') {
    const { template, roster, preset, outDir } = command.files;
    // Validate platform-specific path spelling even when a strict job will emit no files.
    nativePath(outDir);
    const [templateBytes, rosterBytes, fonts, presetBytes] = await Promise.all([
      readLocal(template), readLocal(roster), loadFonts(), preset && readLocal(preset),
    ]);
    return { outDir, job: { mode: command.mode, command, sources: {
      template: templateBytes, roster: rosterBytes, templateName: basename(template), rosterName: basename(roster),
      presetJson: presetBytes ? new TextDecoder('utf-8', { fatal: true }).decode(presetBytes) : undefined, fonts, date,
    } } };
  }
  if (command.mode === 'studio') {
    nativePath(command.outDir);
    return { outDir: command.outDir, job: { mode: 'studio', template: command.template, fonts: await loadFonts() } };
  }
  if (command.mode === 'extract') {
    nativePath(command.outDir);
    let paths: string[];
    if ('inDir' in command.source) {
      const directory = await localInput(command.source.inDir, 'directory');
      const entries = await readdir(directory, { withFileTypes: true });
      paths = entries.filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name)).map(({ name }) => name).sort()
        .map((name) => join(directory, name));
    } else {
      paths = command.source.paths;
    }
    if (paths.length < 1 || paths.length > 200) throw new CliUsageError('Extract accepts 1 to 200 regular PDF files.');
    return { outDir: command.outDir, job: { mode: 'extract', inputs: await readPdfFiles(paths) } };
  }
  const manifestJson = new TextDecoder('utf-8', { fatal: true }).decode(await readLocal(command.manifest));
  const source = 'qrPayload' in command.source ? command.source : {
    inputs: await readPdfFiles(command.source.paths), variant: command.source.variant,
  };
  return { job: { mode: 'verify', manifestJson, source } };
}

async function inspectPath(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

type FileIdentity = { dev: number; ino: number };

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}

function samePath(left: string, right: string) {
  return process.platform === 'win32' ? left.toUpperCase() === right.toUpperCase() : left === right;
}

async function outputDirectory(path: string) {
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    let info = await inspectPath(current);
    if (!info) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      info = await lstat(current);
    }
    if (!info.isDirectory() || !samePath(await realpath(current), current)) {
      throw new Error('Output directory path contains a link, junction, or non-directory: ' + current);
    }
  }
  return lstat(path);
}

async function writeArtifacts(outDir: string, artifacts: Awaited<ReturnType<typeof dispatchCli>>['artifacts']) {
  const directory = nativePath(outDir);
  const names = new Set<string>();
  for (const { name } of artifacts) {
    const key = name.normalize('NFKC').toUpperCase();
    if (!isSafeLocalComponent(name) || names.has(key)) throw new Error('Unsafe or duplicate output name: ' + name);
    names.add(key);
  }

  const directoryIdentity = await outputDirectory(directory);
  const ensureDestination = async () => {
    const current = await lstat(directory);
    if (!current.isDirectory() || !sameIdentity(current, directoryIdentity) || !samePath(await realpath(directory), directory)) {
      throw new Error('Output directory changed during the operation: ' + directory);
    }
  };
  for (const { name } of artifacts) {
    if (await inspectPath(join(directory, name))) throw new Error('Output already exists: ' + join(directory, name));
  }
  const opened: { path: string; file: FileHandle; identity: FileIdentity }[] = [];
  let complete = false;
  try {
    for (const { name } of artifacts) {
      await ensureDestination();
      const path = join(directory, name);
      const file = await open(path, 'wx', 0o600);
      try {
        opened.push({ path, file, identity: await file.stat() });
      } catch (error) {
        await file.close();
        throw error;
      }
    }
    for (const [index, artifact] of artifacts.entries()) {
      await ensureDestination();
      const { path, file, identity } = opened[index]!;
      if (!sameIdentity(await lstat(path), identity)) throw new Error('Output file changed during the operation: ' + path);
      await file.writeFile(artifact.data);
    }
    complete = true;
  } finally {
    await Promise.all(opened.map(({ file }) => file.close()));
    if (!complete) {
      await ensureDestination();
      for (const { path, identity } of opened) {
        const current = await inspectPath(path);
        if (current && sameIdentity(current, identity)) await unlink(path);
      }
    }
  }
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const command = parseCliArgs(process.argv.slice(2));
  if (command.mode === 'help') {
    process.stdout.write(CLI_USAGE + '\n');
    return;
  }
  const { job, outDir } = await loadJob(command, date);
  const result = await dispatchCli(job);
  if (outDir !== undefined && result.artifacts.length) await writeArtifacts(outDir, result.artifacts);
  const channel = result.diagnostic ? process.stderr : process.stdout;
  channel.write(JSON.stringify({ ...result.report, ...(result.artifacts.length && { outputs: result.artifacts.map(({ name }) => name) }) }, null, 2) + '\n');
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  const status = error instanceof CliUsageError ? 'usage-error' : 'io-error';
  process.stderr.write(JSON.stringify({ status, message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
});
