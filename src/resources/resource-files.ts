import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import JSZip from 'jszip';

export type ScriptFiles = Map<string, Uint8Array>;
type ResourceFile =
  | { kind: 'cdb' | 'lflist'; name: string; bytes: Uint8Array }
  | { kind: 'packedScripts'; files: ScriptFiles };

function dataKind(name: string) {
  if (basename(name).startsWith('.')) return undefined;
  if (name.endsWith('.cdb')) return 'cdb' as const;
  if (basename(name) === 'lflist.conf') return 'lflist' as const;
}

async function* readArchive(path: string): AsyncGenerator<ResourceFile> {
  // Reject a corrupt candidate before it can displace the working generation.
  const archive = await JSZip.loadAsync(await readFile(path));
  const loadScripts = path.toLowerCase().endsWith('.ypk');
  const files: ScriptFiles = new Map();
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    const key = entry.name.replace(/\\/g, '/').replace(/^\.?\//, '');
    const kind = dataKind(key);
    if (kind) yield { kind, name: key, bytes: await entry.async('uint8array') };
    if (loadScripts && key.toLowerCase().endsWith('.lua')) {
      const bytes = await entry.async('uint8array');
      files.set(key, bytes);
      if (key.startsWith('script/')) files.set(key.slice(7), bytes);
    }
  }
  if (files.size) yield { kind: 'packedScripts', files };
}

// The scope order matches searchYGOProResource in the pinned core wrapper.
// Inspect loose files across all roots before archives of the same scope.
export async function* resourceFiles(
  roots: string[],
): AsyncGenerator<ResourceFile> {
  for (const scope of ['specials', 'expansions', '']) {
    const archives: string[] = [];
    for (const root of roots) {
      const folder = join(root, scope);
      const entries = await readdir(folder, { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (scope && error.code === 'ENOENT') return [];
          throw error;
        },
      );
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          (!entry.isFile() && !entry.isSymbolicLink())
        )
          continue;
        const path = join(folder, entry.name);
        const kind = dataKind(entry.name);
        if (kind) yield { kind, name: path, bytes: await readFile(path) };
        else if (scope !== 'specials' && /\.(ypk|zip)$/i.test(entry.name))
          archives.push(path);
      }
    }
    for (const path of archives) yield* readArchive(path);
  }
}
