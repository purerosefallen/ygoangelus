import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { BlankReturnMessageDto } from 'nesties';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    let result: BlankReturnMessageDto;
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      result =
        body instanceof BlankReturnMessageDto
          ? body
          : new BlankReturnMessageDto(
              status,
              status === 400 ? 'INVALID_REQUEST' : error.message,
            );
    } else {
      this.logger.error(
        'Unexpected HTTP error',
        error instanceof Error ? error.stack : String(error),
      );
      result = new BlankReturnMessageDto(500, 'INTERNAL_SERVER_ERROR');
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(result.statusCode)
      .json(result);
  }
}
