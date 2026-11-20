import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadConfig } from './config/load-config.js';
import { ResourcesModule } from './resources/resources.module.js';
import { CardsModule } from './cards/cards.module.js';
import { DuelModule } from './duel/duel.module.js';
import { ReadinessController } from './health/readiness.controller.js';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
      ignoreEnvFile: true,
      skipProcessEnv: true,
    }),
    ResourcesModule,
    CardsModule,
    DuelModule,
  ],
  controllers: [ReadinessController],
})
export class AppModule {}
