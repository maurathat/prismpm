/**
 * Where prism-code keeps its own state on this machine, and how it finds a program on the PATH.
 * Imports only node: modules.
 */
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';

/** Where prism-code keeps its own state: `$PRISM_HOME`, default `~/.prism`, as the container store does. */
export const prismHome = (env = process.env, home = homedir()) => env.PRISM_HOME || join(home, '.prism');

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * The executable `name` resolves to on the PATH, or null. On Windows the first PATHEXT extension present in a
 * directory wins, as cmd.exe resolves it. The context makes it testable: `exists(path)` defaults to the disk.
 */
export function which(name, { env = process.env, platform = process.platform, exists = isExecutable } = {}) {
  const windows = platform === 'win32';
  const path = (windows ? (env.Path ?? env.PATH) : env.PATH) ?? '';
  const extensions = windows ? (env.PATHEXT || DEFAULT_PATHEXT).split(';').filter(Boolean) : [''];
  const candidates = windows && extname(name) !== '' ? [''] : extensions;
  for (const dir of path.split(windows ? ';' : ':')) {
    if (!dir) continue;
    for (const extension of candidates) {
      const file = join(dir, `${name}${extension.toLowerCase()}`);
      if (exists(file, windows)) return file;
    }
  }
  return null;
}

function isExecutable(file, windows) {
  try {
    if (!statSync(file).isFile()) return false;
    if (!windows) accessSync(file, constants.X_OK);
    return true;
  } catch {
    // Node cannot stat an app execution alias (wt.exe in WindowsApps) and calls it missing; its directory still lists it.
    if (!windows) return false;
    try {
      const name = basename(file).toLowerCase();
      return readdirSync(dirname(file)).some((entry) => entry.toLowerCase() === name);
    } catch {
      return false;
    }
  }
}
