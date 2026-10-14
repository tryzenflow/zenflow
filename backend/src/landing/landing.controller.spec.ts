import { RequestMethod, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DEFAULT_APK_URL, LANDING } from "./landing.content";
import { LandingController } from "./landing.controller";
import { renderLandingPage } from "./landing.render";

describe("landing content", () => {
  it("has the same sections in English and Vietnamese", () => {
    for (const key of ["features", "steps", "how", "faq", "sources"] as const) {
      expect(LANDING.vi[key]).toHaveLength(LANDING.en[key].length);
    }
    expect(LANDING.vi.features.map((f) => f.icon)).toEqual(
      LANDING.en.features.map((f) => f.icon),
    );
  });
});

describe("renderLandingPage", () => {
  it("links the APK and escapes it", () => {
    const html = renderLandingPage("en", 'https://x.test/a"<b>.apk');
    expect(html).toContain('href="https://x.test/a&quot;&lt;b&gt;.apk"');
    expect(html).not.toContain("<b>.apk");
  });

  it("adds absolute tags only with a base URL", () => {
    const bare = renderLandingPage("en", DEFAULT_APK_URL);
    expect(bare).toContain('<meta name="description"');
    expect(bare).toContain('"@type":"MobileApplication"');
    expect(bare).not.toContain('rel="canonical"');

    const full = renderLandingPage("vi", DEFAULT_APK_URL, "https://z.test/");
    expect(full).toContain(
      '<link rel="canonical" href="https://z.test/?lang=vi">',
    );
    expect(full).toContain('hreflang="en" href="https://z.test/?lang=en"');
    expect(full).toContain('hreflang="x-default" href="https://z.test/"');
  });

  it("adds a share card and social metadata per language", () => {
    const vi = renderLandingPage("vi", DEFAULT_APK_URL, "https://z.test");
    expect(vi).toContain(
      'property="og:image" content="https://z.test/landing/og-vi.png"',
    );
    expect(vi).toContain('property="og:image:width" content="1200"');
    expect(vi).toContain('property="og:image:height" content="630"');
    expect(vi).toContain('property="og:image:alt"');
    expect(vi).toContain('name="twitter:card" content="summary_large_image"');
    expect(vi).toContain(
      'name="twitter:image" content="https://z.test/landing/og-vi.png"',
    );
    expect(
      renderLandingPage("en", DEFAULT_APK_URL, "https://z.test"),
    ).toContain("/landing/og-en.png");
  });

  it("publishes structured data for the site, the app and the FAQ", () => {
    const html = renderLandingPage("en", DEFAULT_APK_URL);
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(
      html,
    )![1];
    const types = (JSON.parse(json) as { "@type": string }[]).map(
      (n) => n["@type"],
    );
    expect(types).toEqual(["WebSite", "MobileApplication", "FAQPage"]);
    expect(json).not.toContain("<");
  });

  it("leaves out screenshots whose file is missing", () => {
    const html = renderLandingPage("en", DEFAULT_APK_URL);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("A look inside");
  });

  it("renders in the requested language with a switch to the other", () => {
    const html = renderLandingPage("vi", DEFAULT_APK_URL);
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain(LANDING.vi.headline);
    expect(html).toContain('href="/?lang=en"');
    expect(html).toContain('href="/privacy?lang=vi"');
  });
});

describe("GET /, /robots.txt and /sitemap.xml", () => {
  let app: INestApplication;
  const env: Record<string, string> = { PUBLIC_URL: "https://z.test" };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LandingController],
    })
      .useMocker((token) =>
        token === ConfigService ? { get: (k: string) => env[k] } : undefined,
      )
      .compile();
    app = module.createNestApplication();
    // Same exclusion as main.ts: these are not under /api/v1.
    app.setGlobalPrefix("api/v1", {
      exclude: [
        { path: "/", method: RequestMethod.GET },
        "robots.txt",
        "sitemap.xml",
      ],
    });
    await app.init();
  });

  afterAll(() => app.close());

  it("serves the landing page as cacheable HTML in the browser language", async () => {
    const res = await request(app.getHttpServer())
      .get("/")
      .set("Accept-Language", "vi-VN,vi;q=0.9")
      .expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toContain("public");
    expect(res.headers["content-security-policy"]).toContain("img-src 'self'");
    expect(res.headers.vary).toContain("Accept-Language");
    expect(res.text).toContain('<html lang="vi">');
    expect(res.text).toContain(DEFAULT_APK_URL);
  });

  it("honours ?lang over Accept-Language", async () => {
    const res = await request(app.getHttpServer())
      .get("/?lang=en")
      .set("Accept-Language", "vi")
      .expect(200);
    expect(res.text).toContain(LANDING.en.headline);
  });

  it("serves robots.txt and a sitemap with the public origin", async () => {
    const robots = await request(app.getHttpServer())
      .get("/robots.txt")
      .expect(200);
    expect(robots.text).toContain("Sitemap: https://z.test/sitemap.xml");
    const sitemap = await request(app.getHttpServer())
      .get("/sitemap.xml")
      .expect(200);
    expect(sitemap.text).toContain("<loc>https://z.test/privacy</loc>");
  });

  it("is not also mounted under the API prefix", async () => {
    await request(app.getHttpServer()).get("/api/v1/robots.txt").expect(404);
  });
});
