import { readFileSync } from "fs";

const FILE_SUFFIX = "_FILE";

/**
 * Docker/Kubernetes-style `*_FILE` secrets: when `FOO_FILE=/run/secrets/foo` is
 * set and `FOO` is not, read the file and expose its contents as `FOO`.
 *
 * Why: platform secret managers (Docker/Swarm secrets, Kubernetes volumes,
 * Vault agent, SOPS-decrypted tmpfs files) hand secrets over as files, and a
 * file keeps the value out of `docker inspect` / `/proc/<pid>/environ` dumps.
 * Must run before `ConfigModule.forRoot()` snapshots `process.env`, so it is
 * imported first in `main.ts`. `docker-entrypoint.sh` does the same for CLI
 * processes (`prisma migrate deploy`) that never load this module.
 *
 * An explicit `FOO` always wins over `FOO_FILE`. A single trailing newline is
 * stripped (editors and `echo` add one); nothing else is trimmed.
 */
export function loadFileSecrets(
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (p) => readFileSync(p, "utf8"),
): string[] {
  const loaded: string[] = [];
  for (const [key, path] of Object.entries(env)) {
    if (!key.endsWith(FILE_SUFFIX) || !path) continue;
    const target = key.slice(0, -FILE_SUFFIX.length);
    if (!target || env[target] !== undefined) continue;
    let contents: string;
    try {
      contents = read(path);
    } catch (err) {
      // Fail fast and never echo the contents; only the var name and path.
      throw new Error(
        `${key} points to ${path}, which could not be read: ${(err as Error).message}`,
      );
    }
    env[target] = contents.replace(/\r?\n$/, "");
    loaded.push(target);
  }
  return loaded;
}

loadFileSecrets();
