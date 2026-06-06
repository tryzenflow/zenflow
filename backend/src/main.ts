import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import session from "express-session";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { createClient } from "redis";
import { RedisStore } from "connect-redis";
import passport from "passport";

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
    session({
      secret: configService.get("SESSION_SECRET")!,
      store: redisStore,
      // see explanations for `resave` and `saveUninitialized` at https://stackoverflow.com/a/40396102/16164473
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  await app.listen(process.env.PORT ?? 5000);
}
bootstrap();
