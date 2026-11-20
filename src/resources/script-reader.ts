import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { MapScriptReader } from 'koishipro-core.js';

type Entry = [string, number, number];
export interface Scripts {
  bytes: SharedArrayBuffer;
  directories: Entry[][];
  archives: Entry[][];
}

async function walk(
  root: string,
  relative: string,
  ancestors: Set<string>,
  out: Map<string, Uint8Array>,
) {
  const path = join(root, relative);
  const real = await realpath(path);
  if (ancestors.has(real)) return;
  const next = new Set(ancestors).add(real);
  const entries = await readdir(path, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const name = relative ? relative + '/' + ent.name : ent.name;
    const entry = ent.isSymbolicLink() ? await stat(join(root, name)) : ent;
    if (entry.isDirectory()) await walk(root, name, next, out);
    else if (ent.name.toLowerCase().endsWith('.lua'))
      out.set(name, await readFile(join(root, name)));
  }
}

export async function snapshotScripts(roots: string[]): Promise<Scripts> {
  const directories: Map<string, Uint8Array>[] = [];
  for (const root of roots) {
    const map = new Map<string, Uint8Array>();
    await walk(root, '', new Set(), map);
    directories.push(map);
  }
  const archives: Map<string, Uint8Array>[] = [];
  for (const sub of ['expansions', ''])
    for (const root of roots) {
      const names = await readdir(join(root, sub)).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return [] as string[];
          throw e;
        },
      );
      for (const name of names
        .filter((n) => n.toLowerCase().endsWith('.ypk'))
        .sort()) {
        const zip = await JSZip.loadAsync(
          await readFile(join(root, sub, name)),
        );
        const map = new Map<string, Uint8Array>();
        for (const f of Object.values(zip.files))
          if (!f.dir && f.name.toLowerCase().endsWith('.lua')) {
            const key = f.name.replace(/\\/g, '/').replace(/^\.?\//, '');
            const content = await f.async('uint8array');
            map.set(key, content);
            if (key.startsWith('script/')) map.set(key.slice(7), content);
          }
        archives.push(map);
      }
    }
  const maps = [...directories, ...archives];
  const size = maps.reduce(
    (n, m) => n + Array.from(m.values()).reduce((s, b) => s + b.length, 0),
    0,
  );
  const bytes = new Uint8Array(new SharedArrayBuffer(size));
  let offset = 0;
  function pack(map: Map<string, Uint8Array>): Entry[] {
    return Array.from(map, ([name, content]) => {
      const start = offset;
      bytes.set(content, offset);
      offset += content.length;
      return [name, start, content.length];
    });
  }
  return {
    bytes: bytes.buffer,
    directories: directories.map(pack),
    archives: archives.map(pack),
  };
}
export function scriptReader(scripts: Scripts) {
  const map = (entries: Entry[]) =>
    new Map(
      entries.map(([key, offset, length]) => [
        key,
        new Uint8Array(scripts.bytes, offset, length),
      ]),
    );
  const dirs = scripts.directories.map((entries) =>
    MapScriptReader(map(entries)),
  );
  const zip = MapScriptReader(...scripts.archives.map(map));
  return (name: string) => {
    for (const read of dirs) {
      const value = read(name);
      if (value != null) return value;
    }
    return zip(name);
  };
}
