import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { parseBool } from 'nesties';

export interface ResourceConfig {
  roots: string[];
  preload: string[];
  wasmPath: string;
  refreshMinutes: number;
}
export interface DeckLimits {
  minMain: number;
  maxMain: number;
  maxExtra: number;
  maxSide: number;
  maxCopies: number;
}

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s: string) => s.trim())
    .filter(Boolean);

function integer(
  value: unknown,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error('Invalid numeric configuration');
  return number;
}

export function resolveConfig(
  file: Record<string, unknown> = {},
  environment: NodeJS.ProcessEnv = process.env,
) {
  const v = { ...file, ...environment };
  const limits: DeckLimits = {
    minMain: integer(v.DECK_MAIN_MIN, 40, 0),
    maxMain: integer(v.DECK_MAIN_MAX, 60, 0),
    maxExtra: integer(v.DECK_EXTRA_MAX, 15, 0),
    maxSide: integer(v.DECK_SIDE_MAX, 15, 0),
    maxCopies: integer(v.DECK_MAX_COPIES, 3, 0),
  };
  if (limits.minMain > limits.maxMain) throw new Error('Invalid deck limits');
  const resources: ResourceConfig = {
    roots: list(v.YGOPRO_PATH ?? './ygopro').map((p) => resolve(p)),
    preload: [
      './script/patches/entry.lua',
      './script/special.lua',
      './script/init.lua',
      ...list(v.EXTRA_SCRIPT_PATH),
    ],
    wasmPath: String(v.OCGCORE_WASM_PATH || v.DEFAULT_OCGCORE_WASM_PATH || ''),
    refreshMinutes: integer(v.YGOPRO_RESOURCE_REFRESH_MINUTES, 10, 0),
  };
  return {
    resources,
    limits,
    SERVER_TOKEN: String(v.SERVER_TOKEN ?? ''),
    NO_OPENAPI: !!parseBool(v.NO_OPENAPI),
    OCGCORE_DEBUG_LOG: !!parseBool(v.OCGCORE_DEBUG_LOG),
    host: String(v.host ?? '::'),
    port: integer(v.port, 3001, 0, 65535),
  };
}
export async function loadConfig() {
  let settings: Record<string, unknown> = {};
  try {
    settings = parse(await readFile('config.yaml', 'utf8')) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return resolveConfig(settings);
}
