import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Readable } from "stream";
import { FileUrlSignerService } from "./file-url-signer.service";
import { FilesController } from "./files.controller";

function setup() {
  const signer = new FileUrlSignerService({
    getOrThrow: () => "k".repeat(32),
  } as unknown as ConfigService);
  const download = jest.fn().mockResolvedValue({
    file: { originalName: "a.png", mimetype: "image/png" },
    stream: Readable.from(["x"]),
  });
  const getMetadata = jest.fn().mockResolvedValue({
    id: "f1",
    originalName: "a.png",
    mimetype: "image/png",
    size: 1,
  });
  const ctrl = new FilesController({ download, getMetadata } as never, signer);
  const res = { set: jest.fn() };
  const req = (auth: boolean) =>
    ({ isAuthenticated: () => auth, user: { id: "u1" } }) as never;
  return { signer, ctrl, download, res, req, getMetadata };
}

describe("FilesController.stream", () => {
  it("serves with a valid sig and no session, skipping ownership", async () => {
    const { ctrl, signer, download, res, req } = setup();
    await ctrl.stream("f1", signer.sign("f1"), req(false), res as never);
    expect(download).toHaveBeenCalledWith("f1", undefined);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Cache-Control": "private, max-age=31536000, immutable",
      }),
    );
  });

  it("rejects a bad sig without a session (401)", async () => {
    const { ctrl, download, res, req } = setup();
    await expect(
      ctrl.stream("f1", "bad", req(false), res as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(download).not.toHaveBeenCalled();
  });

  it("rejects a sig for another id without a session", async () => {
    const { ctrl, signer, res, req } = setup();
    await expect(
      ctrl.stream("f2", signer.sign("f1"), req(false), res as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects no sig and no session (401)", async () => {
    const { ctrl, res, req } = setup();
    await expect(
      ctrl.stream("f1", undefined, req(false), res as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("cookie path keeps the ownership check", async () => {
    const { ctrl, download, res, req } = setup();
    await ctrl.stream("f1", undefined, req(true), res as never);
    expect(download).toHaveBeenCalledWith("f1", "u1");
  });

  it("metadata includes the signed url", async () => {
    const { ctrl, signer } = setup();
    const out = await ctrl.getMetadata("f1", { id: "u1" } as never);
    expect(out.data.url).toBe(signer.url("f1"));
  });
});
