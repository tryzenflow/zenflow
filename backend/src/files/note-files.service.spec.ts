import { ConfigService } from "@nestjs/config";
import { FileUrlSignerService } from "./file-url-signer.service";
import { NoteFilesService } from "./note-files.service";
import type { FilesService } from "./files.service";
import type { PrismaService } from "../prisma/prisma.service";

const signer = new FileUrlSignerService({
  getOrThrow: () => "s".repeat(32),
} as unknown as ConfigService);

const make = (ownedIds: string[]) => {
  const findMany = jest.fn().mockResolvedValue(ownedIds.map((id) => ({ id })));
  const remove = jest.fn().mockResolvedValue(undefined);
  const svc = new NoteFilesService(
    { file: { findMany } } as unknown as PrismaService,
    signer,
    { remove } as unknown as FilesService,
  );
  return { svc, findMany, remove };
};

/** Service whose session notes are read from `notes()` on each call. */
const makeReleasing = (notes: () => string[]) => {
  const sessionFindMany = jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(notes().map((note) => ({ note }))),
    );
  const remove = jest.fn().mockResolvedValue(undefined);
  const svc = new NoteFilesService(
    { session: { findMany: sessionFindMany } } as unknown as PrismaService,
    signer,
    { remove } as unknown as FilesService,
  );
  return { svc, remove, sessionFindMany };
};

const link = (id: string, sig = "") =>
  `<p><a href="/api/v1/files/${id}${sig}">f</a></p>`;

describe("NoteFilesService", () => {
  it("sign() adds a fresh sig to relative and validly-signed refs only", () => {
    const { svc } = make([]);
    const lms = '<a href="https://lms.example/api/v1/files/9">x</a>';
    const out = svc.sign(
      `<img src="/api/v1/files/a"><img src="https://h/api/v1/files/b?sig=${signer.sign("b")}">${lms}`,
    );
    expect(out).toBe(
      `<img src="${signer.url("a")}"><img src="${signer.url("b")}">${lms}`,
    );
  });

  it("sign() passes null/empty through", () => {
    const { svc } = make([]);
    expect(svc.sign(null)).toBeNull();
    expect(svc.sign("")).toBe("");
  });

  it("normalize() strips sigs from owned files", async () => {
    const { svc, findMany } = make(["a"]);
    const out = await svc.normalize(
      `<img src="https://h/api/v1/files/a?sig=${signer.sign("a")}">`,
      "u1",
    );
    expect(out).toBe('<img src="/api/v1/files/a">');
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] }, userId: "u1" },
      select: { id: true },
    });
  });

  it("normalize() neutralises refs to files the user does not own", async () => {
    const { svc } = make([]);
    expect(await svc.normalize('<img src="/api/v1/files/other">', "u1")).toBe(
      '<img src="#">',
    );
  });

  it("normalize() leaves foreign-host look-alikes alone", async () => {
    const { svc } = make([]);
    const lms = '<a href="https://lms.example/api/v1/files/9">x</a>';
    expect(await svc.normalize(lms, "u1")).toBe(lms);
  });

  it("normalize() skips the query when there are no refs", async () => {
    const { svc, findMany } = make([]);
    expect(await svc.normalize("<p>hi</p>", "u1")).toBe("<p>hi</p>");
    expect(await svc.normalize(undefined, "u1")).toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  describe("releasingUnreferenced()", () => {
    it("removes a file whose only session was deleted", async () => {
      let notes = [link("a")];
      const { svc, remove } = makeReleasing(() => notes);
      await svc.releasingUnreferenced("u1", () => {
        notes = [];
        return Promise.resolve();
      });
      expect(remove).toHaveBeenCalledWith(["a"], "u1");
    });

    it("keeps a file still linked from another session or sibling", async () => {
      let notes = [link("a"), link("a"), link("b")];
      const { svc, remove } = makeReleasing(() => notes);
      await svc.releasingUnreferenced("u1", () => {
        notes = [link("a")]; // two sessions gone, one still links a
        return Promise.resolve();
      });
      expect(remove).toHaveBeenCalledWith(["b"], "u1");
    });

    it("handles edit: only the dropped original goes; re-added stays", async () => {
      let notes = [link("a") + link("b")];
      const { svc, remove } = makeReleasing(() => notes);
      await svc.releasingUnreferenced("u1", () => {
        notes = [link("a")];
        return Promise.resolve();
      });
      expect(remove).toHaveBeenCalledWith(["b"], "u1");
    });

    it("never removes a file whose id is a prefix of a surviving id", async () => {
      let notes = [link("abc") + link("abcdef")];
      const { svc, remove } = makeReleasing(() => notes);
      await svc.releasingUnreferenced("u1", () => {
        notes = [link("abcdef")];
        return Promise.resolve();
      });
      expect(remove).toHaveBeenCalledWith(["abc"], "u1");
    });

    it("treats signed and canonical refs to the same file as one", async () => {
      let notes = [link("a")];
      const { svc, remove } = makeReleasing(() => notes);
      await svc.releasingUnreferenced("u1", () => {
        notes = [link("a", "?sig=xyz")];
        return Promise.resolve();
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it("ignores metadata URLs and foreign-host look-alikes", async () => {
      let notes = [
        '<a href="/api/v1/files/metadata/m">x</a><a href="https://lms.example/api/v1/files/9">y</a>',
      ];
      const { svc, remove } = makeReleasing(() => notes);
      await svc.releasingUnreferenced("u1", () => {
        notes = [];
        return Promise.resolve();
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it("does not touch files when nothing was referenced (skips the 2nd query)", async () => {
      const { svc, remove, sessionFindMany } = makeReleasing(() => []);
      await svc.releasingUnreferenced("u1", () => Promise.resolve());
      expect(sessionFindMany).toHaveBeenCalledTimes(1);
      expect(remove).not.toHaveBeenCalled();
    });

    it("does not clean up when the mutation throws", async () => {
      const { svc, remove } = makeReleasing(() => [link("a")]);
      await expect(
        svc.releasingUnreferenced("u1", () =>
          Promise.reject(new Error("boom")),
        ),
      ).rejects.toThrow("boom");
      expect(remove).not.toHaveBeenCalled();
    });

    it("swallows a storage failure and still returns the result", async () => {
      let notes = [link("a")];
      const { svc, remove } = makeReleasing(() => notes);
      remove.mockRejectedValue(new Error("s3 down"));
      const out = await svc.releasingUnreferenced("u1", () => {
        notes = [];
        return Promise.resolve("ok");
      });
      expect(out).toBe("ok");
    });
  });
});
