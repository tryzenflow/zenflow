import { loadFileSecrets } from "./file-secrets";

describe("loadFileSecrets", () => {
  const files: Record<string, string> = {
    "/run/secrets/db": "postgres://u:p@h/db\n",
    "/run/secrets/crlf": "abc\r\n",
  };
  const read = (p: string) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };

  it("loads FOO from FOO_FILE and strips one trailing newline", () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL_FILE: "/run/secrets/db",
      X_FILE: "/run/secrets/crlf",
    };
    expect(loadFileSecrets(env, read).sort()).toEqual(["DATABASE_URL", "X"]);
    expect(env.DATABASE_URL).toBe("postgres://u:p@h/db");
    expect(env.X).toBe("abc");
  });

  it("does not override an explicitly set variable", () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: "explicit",
      DATABASE_URL_FILE: "/run/secrets/db",
    };
    expect(loadFileSecrets(env, read)).toEqual([]);
    expect(env.DATABASE_URL).toBe("explicit");
  });

  it("throws without leaking contents when the file is unreadable", () => {
    const env: NodeJS.ProcessEnv = { SESSION_SECRET_FILE: "/nope" };
    expect(() => loadFileSecrets(env, read)).toThrow(/SESSION_SECRET_FILE/);
  });

  it("ignores empty values", () => {
    const env: NodeJS.ProcessEnv = { FOO_FILE: "" };
    expect(loadFileSecrets(env, read)).toEqual([]);
  });
});
