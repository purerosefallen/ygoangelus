import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReturnMessageDto } from 'nesties';
import type { CardDataEntry } from 'ygopro-cdb-encode';

export class CardDataQueryDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'Comma-separated card IDs. Omit to list all cards. An empty value selects no cards.',
    example: '98978921,89631139',
  })
  @IsOptional()
  @IsString()
  id?: string;
}
export class CardDataDto {
  @ApiProperty({ type: 'integer' }) code: number;
  @ApiProperty({ type: 'integer' }) ot: number;
  @ApiProperty({ type: 'integer' }) alias: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'integer', minimum: 0, maximum: 65535 },
    minItems: 16,
    maxItems: 16,
  })
  setcode: number[];
  @ApiProperty({ type: 'integer' }) type: number;
  @ApiProperty({ type: 'integer' }) level: number;
  @ApiProperty({ type: 'integer' }) attribute: number;
  @ApiProperty({ type: 'integer' }) race: number;
  @ApiProperty({ type: 'integer' }) attack: number;
  @ApiProperty({ type: 'integer' }) defense: number;
  @ApiProperty({ type: 'integer' }) lscale: number;
  @ApiProperty({ type: 'integer' }) rscale: number;
  @ApiProperty({ type: 'integer' }) linkMarker: number;
  @ApiProperty({ type: 'integer' }) ruleCode: number;
  constructor(card: CardDataEntry) {
    this.code = card.code;
    this.ot = card.ot;
    this.alias = card.alias;
    this.setcode = [...card.setcode];
    this.type = card.type;
    this.level = card.level;
    this.attribute = card.attribute;
    this.race = card.race;
    this.attack = card.attack;
    this.defense = card.defense;
    this.lscale = card.lscale;
    this.rscale = card.rscale;
    this.linkMarker = card.linkMarker;
    this.ruleCode = card.ruleCode;
  }
}
export class BanlistDto {
  @ApiProperty() name: string;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 4294967295 })
  hash: number;
}
export class LFListsResultDto {
  @ApiProperty({ type: [BanlistDto] }) lists: BanlistDto[];
}
export class DeckLimitsDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 40 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minMain?: number;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxMain?: number;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxExtra?: number;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxSide?: number;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCopies?: number;
}
export class CheckDeckRequestDto {
  @ApiProperty({ type: String, example: 'ydke://ZQAAAGYAAAA=!!!' })
  @IsString()
  deck: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Exact banlist title. Omit or use null for basic validation.',
  })
  @IsOptional()
  @IsString()
  lflist?: string | null;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: 5, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  rule?: number;
  @ApiPropertyOptional({ type: DeckLimitsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeckLimitsDto)
  limits?: DeckLimitsDto;
}
export class DeckErrorDto {
  @ApiProperty({ type: 'integer', description: 'YGOProLFListErrorReason' })
  reason: number;
  @ApiProperty({
    type: 'integer',
    description: 'Card number or count for this reason',
  })
  code: number;
}
export class CheckDeckResultDto {
  @ApiProperty() valid: boolean;
  @ApiPropertyOptional({
    type: DeckErrorDto,
    description: 'Present when valid is false',
  })
  error?: DeckErrorDto;
}
export class CardDataResponseDto extends ReturnMessageDto([CardDataDto]) {}
export class LFListsResponseDto extends ReturnMessageDto(LFListsResultDto) {}
export class CheckDeckResponseDto extends ReturnMessageDto(
  CheckDeckResultDto,
) {}
