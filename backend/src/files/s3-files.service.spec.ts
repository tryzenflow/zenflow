import { Readable } from "stream";
import { mkdtemp, writeFile, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { MAX_UPLOAD_BYTES, MAX_USER_STORAGE_BYTES } from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";
import { FILES_SERVICE, type FilesService } from "./files.service";
import { S3FilesService } from "./s3-files.service";

const mockSend = jest.fn();
const mockDone = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  DeleteObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
  DeleteObjectsCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
}));
jest.mock("@aws-sdk/lib-storage", () => ({
  Upload: jest.fn().mockImplementation(() => ({ done: mockDone })),
}));

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

describe("S3FilesService", () => {
  const prisma = {
    file: {
      createManyAndReturn: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { size: null } }),
    },
  };
  const config = {
    getOrThrow: jest.fn((k: string) => `test-${k}`),
    get: jest.fn((_k: string, d?: string) => d),
  };
  let service: FilesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        { provide: FILES_SERVICE, useClass: S3FilesService },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get<FilesService>(FILES_SERVICE);
  });

  async function tempUpload(name: string) {
    const dir = await mkdtemp(join(tmpdir(), "files-spec-"));
    const path = join(dir, name);
    await writeFile(path, "data");
    return {
      originalName: name,
      filename: name,
      mimetype: "text/plain",
      size: 4,
      path,
    };
  }

  it("uploads to a user-scoped key, stores it as path and removes the temp file", async () => {
    const dto = await tempUpload("a.txt");
    prisma.file.createManyAndReturn.mockResolvedValue([{ id: "1" }]);

    await service.upload([dto], "u1");

    const [args] = prisma.file.createManyAndReturn.mock.calls[0] as [
      { data: { path: string; userId: string }[] },
    ];
    const { data } = args;
    expect(data[0].path).toMatch(/^u1\/[0-9a-f-]{36}$/);
    expect(data[0].userId).toBe("u1");
    expect(await exists(dto.path)).toBe(false);
  });

  it("deletes uploaded objects and the temp file when the DB write fails", async () => {
    const dto = await tempUpload("b.txt");
    prisma.file.createManyAndReturn.mockRejectedValue(new Error("db down"));

    await expect(service.upload([dto], "u1")).rejects.toThrow("db down");

    expect(mockSend).toHaveBeenCalledTimes(1); // DeleteObject for the one key
    expect(await exists(dto.path)).toBe(false);
  });

  describe("upload limits", () => {
    it("rejects a file over the per-file limit and removes the temp file", async () => {
      const dto = {
        ...(await tempUpload("big.bin")),
        size: MAX_UPLOAD_BYTES + 1,
      };

      await expect(service.upload([dto], "u1")).rejects.toThrow(
        "File too large",
      );
      expect(mockDone).not.toHaveBeenCalled();
      expect(await exists(dto.path)).toBe(false);
    });

    it("rejects when the upload would exceed the user quota", async () => {
      const dto = await tempUpload("c.txt");
      prisma.file.aggregate.mockResolvedValue({
        _sum: { size: MAX_USER_STORAGE_BYTES - 3 },
      });

      const err: unknown = await service
        .upload([dto], "u1")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PayloadTooLargeException);
      expect((err as PayloadTooLargeException).message).toBe("Storage full");
      expect(prisma.file.aggregate).toHaveBeenCalledWith({
        where: { userId: "u1" },
        _sum: { size: true },
      });
      expect(mockDone).not.toHaveBeenCalled();
      expect(prisma.file.createManyAndReturn).not.toHaveBeenCalled();
      expect(await exists(dto.path)).toBe(false);
    });

    it("allows an upload that exactly fills the quota", async () => {
      const dto = await tempUpload("d.txt");
      prisma.file.aggregate.mockResolvedValue({
        _sum: { size: MAX_USER_STORAGE_BYTES - dto.size },
      });
      prisma.file.createManyAndReturn.mockResolvedValue([{ id: "1" }]);

      await expect(service.upload([dto], "u1")).resolves.toHaveLength(1);
    });
  });

  it("only deletes rows owned by the caller", async () => {
    prisma.file.findMany.mockResolvedValue([{ id: "mine", path: "u1/k" }]);

    await service.remove(["mine", "theirs"], "u1");

    expect(prisma.file.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["mine", "theirs"] }, userId: "u1" },
    });
    expect(prisma.file.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["mine"] }, userId: "u1" },
    });
  });

  it("keeps the rows when deleting the objects fails, so it can be retried", async () => {
    prisma.file.findMany.mockResolvedValue([{ id: "mine", path: "u1/k" }]);
    mockSend.mockRejectedValue(new Error("s3 down"));

    await expect(service.remove(["mine"], "u1")).rejects.toThrow("s3 down");
    expect(prisma.file.deleteMany).not.toHaveBeenCalled();
  });

  it("treats per-object delete errors as a failure", async () => {
    prisma.file.findMany.mockResolvedValue([{ id: "mine", path: "u1/k" }]);
    mockSend.mockResolvedValue({
      Errors: [{ Key: "u1/k", Code: "AccessDenied", Message: "nope" }],
    });

    await expect(service.remove(["mine"], "u1")).rejects.toThrow(
      /AccessDenied/,
    );
    expect(prisma.file.deleteMany).not.toHaveBeenCalled();
  });

  describe("download", () => {
    const row = { id: "f1", path: "u1/k", originalName: "a.txt", size: 100 };

    it("returns the row and the object body stream", async () => {
      const body = Readable.from(["data"]);
      prisma.file.findUnique.mockResolvedValue(row);
      mockSend.mockResolvedValue({ Body: body });

      const result = await service.download("f1", "u1");

      expect(result.file).toBe(row);
      expect(result.stream).toBe(body);
    });

    it("asks S3 for just the requested bytes", async () => {
      prisma.file.findUnique.mockResolvedValue(row);
      mockSend.mockResolvedValue({ Body: Readable.from(["d"]) });

      const result = await service.download("f1", "u1", "bytes=10-19");

      expect(result.range).toEqual({ start: 10, end: 19 });
      expect(mockSend.mock.calls.at(-1)?.[0].input.Range).toBe("bytes=10-19");
    });

    it("rejects a range past the end with 416", async () => {
      prisma.file.findUnique.mockResolvedValue(row);

      await expect(
        service.download("f1", "u1", "bytes=500-"),
      ).rejects.toMatchObject({ status: 416 });
    });

    it("throws NotFound when the object is missing in the bucket", async () => {
      prisma.file.findUnique.mockResolvedValue(row);
      mockSend.mockRejectedValue(
        Object.assign(new Error("gone"), { name: "NoSuchKey" }),
      );

      await expect(service.download("f1", "u1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws NotFound when the response has no readable body", async () => {
      prisma.file.findUnique.mockResolvedValue(row);
      mockSend.mockResolvedValue({ Body: undefined });

      await expect(service.download("f1", "u1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("rethrows other S3 errors", async () => {
      prisma.file.findUnique.mockResolvedValue(row);
      mockSend.mockRejectedValue(new Error("boom"));

      await expect(service.download("f1", "u1")).rejects.toThrow("boom");
    });
  });

  it("throws NotFound for a missing file", async () => {
    prisma.file.findUnique.mockResolvedValue(null);
    await expect(service.findOne("x", "u1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getMetadata("x", "u1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
