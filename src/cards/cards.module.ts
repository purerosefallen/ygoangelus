import { Module } from '@nestjs/common';
import { ResourcesModule } from '../resources/resources.module.js';
import { CardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';
@Module({
  imports: [ResourcesModule],
  providers: [CardsService],
  controllers: [CardsController],
})
export class CardsModule {}
