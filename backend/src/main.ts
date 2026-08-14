import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import session from "express-session";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { RedisClientType } from "redis";
import { RedisStore } from "connect-redis";
import passport from "passport";
import { buildSessionOptions } from "./auth/session.config";
import { REDIS_CLIENT } from "./common/redis/redis.constants";

// 7 days. Default lifetime of an idle session; with rolling sessions an
// actively-used session keeps getting extended on every request.
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // TLS is terminated by the Caddy reverse proxy, which forwards plain HTTP to
  // this app with the real scheme in `X-Forwarded-Proto`. Trusting the first
  // proxy hop makes `req.secure` reflect that header, so express-session will
  // emit the `Secure` session cookie instead of silently dropping it. This must
  // be set before the session middleware is registered.
  app.set("trust proxy", 1);
  const configService = app.get(ConfigService);
  app.setGlobalPrefix("api/v1");
  // Comma-separated list: the web frontend and Expo's web dev server are
  // separate origins. `cors` only echoes a single origin back, so this must be
  // an array for it to match the request and reflect the right one.
  const corsOrigins = (configService.get<string>("CORS_ORIGIN") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: "Content-Type, Accept, Authorization, x-timezone", // Include necessary headers
    credentials: true,
    // Rate-limit headers set by LimitKit's LimitGuard on 429 responses
    // (see common/rate-limit/) — browsers hide non-simple response headers
    // from JS by default, so the FE/mobile countdown UI needs these
    // explicitly exposed via Access-Control-Expose-Headers.
    exposedHeaders:
      "Retry-After, RateLimit-Limit, RateLimit-Remaining, Reset-After",
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Reuse the single shared, already-connected Redis client (see
  // common/redis/redis.module.ts) — the LimitKit rate limiter (common/
  // rate-limit/) uses the same client rather than opening a second
  // connection.
  const redisClient = app.get<RedisClientType>(REDIS_CLIENT);

  const redisStore = new RedisStore({
    client: redisClient,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Zenflow API")
    .setDescription("Documentation for Zenflow API")
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api", app, document); // available at <API_URL>/api

  app.use(
    session(
      buildSessionOptions({
        secret: configService.get("SESSION_SECRET")!,
        store: redisStore,
        ttlMs:
          configService.get<number>("SESSION_TTL_MS") ?? DEFAULT_SESSION_TTL_MS,
        secure: configService.get<boolean>("COOKIE_SECURE")!,
        sameSite: configService.get<"lax" | "none" | "strict">(
          "COOKIE_SAMESITE",
        )!,
      }),
    ),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  await app.listen(process.env.PORT ?? 5000);
}
bootstrap();
