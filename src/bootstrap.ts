import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { HttpErrorFilter } from './http-exception.filter.js';
export function configureApp(app: INestApplication) {
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableCors();
  if (!app.get(ConfigService).get('NO_OPENAPI')) {
    const doc = new DocumentBuilder()
      .setTitle('ygoangelus')
      .setVersion('1.0')
      .setDescription(
        'Card data, banlists and deck validation. [Duel WebSocket protocol (GET /duel, ygoangelus.v1)](https://github.com/purerosefallen/ygoangelus/blob/master/docs/websocket.md). When SERVER_TOKEN is configured, send x-server-token in the HTTP upgrade headers.',
      )
      .build();
    SwaggerModule.setup('docs', app, () =>
      SwaggerModule.createDocument(app, doc),
    );
  }
}
