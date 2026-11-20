import { Module } from '@nestjs/common';
import { ResourceLoader } from './resource-loader.service.js';
@Module({ providers: [ResourceLoader], exports: [ResourceLoader] })
export class ResourcesModule {}
