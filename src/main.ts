import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
const app = await NestFactory.create(AppModule);
configureApp(app);
app.enableShutdownHooks();
const config = app.get(ConfigService);
await app.listen(
  config.getOrThrow<number>('port'),
  config.getOrThrow<string>('host'),
);
