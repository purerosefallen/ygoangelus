import { Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RequireToken,
  ApiTypeResponse,
  ApiError,
  DataQuery,
  DataBody,
} from 'nesties';
import {
  CardDataQueryDto,
  CardDataDto,
  CheckDeckRequestDto,
  CheckDeckResultDto,
  LFListsResultDto,
  CardDataResponseDto,
  LFListsResponseDto,
  CheckDeckResponseDto,
} from './cards.dto.js';
import { CardsService } from './cards.service.js';

@ApiTags('Card resources')
@RequireToken()
@Controller()
export class CardsController {
  constructor(private readonly cards: CardsService) {}
  @Get('lflists')
  @ApiOperation({ summary: 'List banlists in resource order' })
  @ApiTypeResponse(LFListsResultDto)
  lists() {
    return new LFListsResponseDto(200, 'success', this.cards.lists());
  }
  @Get('card-data')
  @ApiOperation({
    summary: 'Read parsed card data',
    description:
      'Without id, returns the complete resource set in code order. Within id, skips unknown or invalid numbers and keeps the first occurrence.',
  })
  @ApiTypeResponse([CardDataDto])
  @ApiError(400, 'INVALID_REQUEST')
  data(@DataQuery() query: CardDataQueryDto) {
    return new CardDataResponseDto(200, 'success', this.cards.cards(query.id));
  }
  @Post('check-deck')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check a YDKE deck' })
  @ApiTypeResponse(CheckDeckResultDto)
  @ApiError(400, 'INVALID_REQUEST')
  @ApiError(404, 'LFLIST_NOT_FOUND')
  check(@DataBody() input: CheckDeckRequestDto) {
    return new CheckDeckResponseDto(200, 'success', this.cards.check(input));
  }
}
