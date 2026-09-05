import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BrowserContext, chromium, Page } from "playwright";

@Injectable()
export class LMSService {
  private readonly endpoint: string;

  constructor(private readonly configService: ConfigService) {
    this.endpoint = this.configService.getOrThrow("LMS_URL");
  }

  async initBrowser() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: this.endpoint,
    });
    const page = await context.newPage();

    return { browser, page, context };
  }

  async authenticate(
    username: string,
    password: string,
    page: Page,
    context: BrowserContext,
  ) {
    try {
      await page.goto("/login/index.php");

      await page.fill("input#username", username);
      await page.fill("input#password", password);
      await page.click("button#loginbtn");

      await page.waitForURL("**/my/", {
        timeout: 5000,
      });

      return await context.cookies();
    } catch {
      throw new Error("Invalid login. Please update your credentials");
    }
  }
}
