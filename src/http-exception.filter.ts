import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { BlankReturnMessageDto } from 'nesties';
@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: HttpException, host: ArgumentsHost) {
    const code = error.getStatus(),
      body = error.getResponse();
    const result =
      body instanceof BlankReturnMessageDto
        ? body
        : new BlankReturnMessageDto(
            code,
            code === 400 ? 'INVALID_REQUEST' : error.message,
          );
    host.switchToHttp().getResponse<Response>().status(code).json(result);
  }
}
