import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiBlankResponse, ApiError, BlankReturnMessageDto } from 'nesties';
import { ResourceLoader } from '../resources/resource-loader.service.js';
@ApiTags('Health')
@Controller()
export class ReadinessController {
  constructor(private readonly resources: ResourceLoader) {}
  @Get('readyz')
  @ApiOperation({ summary: 'Report readiness for new requests' })
  @ApiBlankResponse()
  @ApiError(503, 'NOT_READY')
  ready() {
    if (!this.resources.ready)
      throw new BlankReturnMessageDto(503, 'NOT_READY').toException();
    return new BlankReturnMessageDto(200);
  }
}
