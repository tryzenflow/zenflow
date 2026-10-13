import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { LEGAL_DOCS } from "./legal.docs";
import { LegalController, pickLang } from "./legal.controller";
import { renderLegalPage } from "./legal.render";

describe("pickLang", () => {
  it("prefers an explicit ?lang", () => {
    expect(pickLang("en", "vi-VN,vi;q=0.9")).toBe("en");
    expect(pickLang("vi", "en-US")).toBe("vi");
  });

  it("falls back to the browser's first language, then English", () => {
    expect(pickLang(undefined, "vi-VN,vi;q=0.9,en;q=0.8")).toBe("vi");
    expect(pickLang("fr", "en-US,en;q=0.9")).toBe("en");
    expect(pickLang(undefined, undefined)).toBe("en");
  });
});

describe("legal content", () => {
  it("has the same sections in English and Vietnamese", () => {
    for (const page of ["privacy", "terms"] as const) {
      const { en, vi } = LEGAL_DOCS[page];
      expect(vi.sections).toHaveLength(en.sections.length);
      en.sections.forEach((s, i) => {
        expect(vi.sections[i].body).toHaveLength(s.body.length);
        s.body.forEach((b, j) => {
          const other = vi.sections[i].body[j];
          expect(typeof other).toBe(typeof b);
          if (typeof b !== "string" && typeof other !== "string") {
            expect(other.list).toHaveLength(b.list.length);
          }
        });
      });
    }
  });
});

describe("renderLegalPage", () => {
  it("links the contact email and escapes it", () => {
    const html = renderLegalPage("privacy", "en", 'a"<b>@x.test');
    expect(html).toContain('href="mailto:a&quot;&lt;b&gt;@x.test"');
    expect(html).not.toContain("<b>@x.test");
  });

  it("adds SEO metadata and an inline favicon, and absolute tags only with a base URL", () => {
    const bare = renderLegalPage("privacy", "en", "a@x.test");
    expect(bare).toContain('<meta name="description"');
    expect(bare).toContain('<meta name="robots" content="index,follow">');
    expect(bare).toContain(
      'rel="icon" type="image/svg+xml" href="data:image/svg+xml,',
    );
    expect(bare).toContain('property="og:title"');
    expect(bare).not.toContain('rel="canonical"');

    const full = renderLegalPage(
      "privacy",
      "vi",
      "a@x.test",
      "https://z.test/",
    );
    expect(full).toContain(
      '<link rel="canonical" href="https://z.test/privacy?lang=vi">',
    );
    expect(full).toContain(
      'hreflang="en" href="https://z.test/privacy?lang=en"',
    );
    expect(full).toContain(
      'property="og:url" content="https://z.test/privacy?lang=vi"',
    );
  });

  it("renders in the requested language with a switch to the other", () => {
    const html = renderLegalPage("terms", "vi", "a@x.test");
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain("Điều khoản dịch vụ");
    expect(html).toContain('href="/terms?lang=en"');
    expect(html).toContain('href="/privacy?lang=vi"');
    expect(html).not.toContain("{{email}}");
    expect(html).toContain("Zenflow. Bảo lưu mọi quyền.");
    expect(renderLegalPage("terms", "en", "a@x.test")).toContain(
      "Zenflow. All rights reserved.",
    );
  });
});

describe("GET /privacy and /terms", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LegalController],
    })
      .useMocker((token) =>
        token === ConfigService
          ? { get: () => "privacy@zenflow.test" }
          : undefined,
      )
      .compile();
    app = module.createNestApplication();
    // Same exclusion as main.ts: the pages are not under /api/v1.
    app.setGlobalPrefix("api/v1", { exclude: ["privacy", "terms"] });
    await app.init();
  });

  afterAll(() => app.close());

  it.each(["/privacy", "/terms"])(
    "serves %s as cacheable HTML",
    async (path) => {
      const res = await request(app.getHttpServer())
        .get(path)
        .set("Accept-Language", "vi-VN,vi;q=0.9")
        .expect(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["cache-control"]).toContain("public");
      expect(res.headers["content-security-policy"]).toContain(
        "default-src 'none'",
      );
      expect(res.headers.vary).toContain("Accept-Language");
      expect(res.text).toContain('<html lang="vi">');
      expect(res.text).toContain("privacy@zenflow.test");
    },
  );

  it("honours ?lang over Accept-Language", async () => {
    const res = await request(app.getHttpServer())
      .get("/privacy?lang=en")
      .set("Accept-Language", "vi")
      .expect(200);
    expect(res.text).toContain("Privacy Policy");
  });

  it("is not also mounted under the API prefix", async () => {
    await request(app.getHttpServer()).get("/api/v1/privacy").expect(404);
  });
});
