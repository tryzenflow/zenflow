import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import session from "express-session";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { createClient } from "redis";
import { RedisStore } from "connect-redis";
import passport from "passport";
import { buildSessionOptions } from "./auth/session.config";

// 7 days. Default lifetime of an idle session; with rolling sessions an
// actively-used session keeps getting extended on every request.
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: configService.get("CORS_ORIGIN"),
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: "Content-Type, Accept, Authorization, x-timezone", // Include necessary headers
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const redisClient = createClient({
    url: configService.get("CACHE_URL"),
  });
  await redisClient.connect();

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
        isProduction: process.env.NODE_ENV === "production",
      }),
    ),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  await app.listen(process.env.PORT ?? 5000);
}
bootstrap();
