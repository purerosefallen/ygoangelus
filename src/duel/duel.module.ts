import { Module } from '@nestjs/common';
import { TokenGuard } from 'nesties';
import { ResourcesModule } from '../resources/resources.module.js';
import { DuelUpgradeService } from './duel-upgrade.service.js';
import { DuelWorkerService } from './duel-worker.service.js';
@Module({
  imports: [ResourcesModule],
  providers: [TokenGuard, DuelWorkerService, DuelUpgradeService],
})
export class DuelModule {}
