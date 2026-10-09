import { ConfigService } from "@nestjs/config";
import { FileUrlSignerService } from "./file-url-signer.service";
import { NoteFilesService } from "./note-files.service";
import type { PrismaService } from "../prisma/prisma.service";

const signer = new FileUrlSignerService({
  getOrThrow: () => "s".repeat(32),
} as unknown as ConfigService);

const make = (ownedIds: string[]) => {
  const findMany = jest.fn().mockResolvedValue(ownedIds.map((id) => ({ id })));
  const svc = new NoteFilesService(
    { file: { findMany } } as unknown as PrismaService,
    signer,
  );
  return { svc, findMany };
};

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
});
