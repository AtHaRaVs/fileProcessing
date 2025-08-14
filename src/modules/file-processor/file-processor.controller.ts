import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiKeyGuard } from '../../guards/api-key.guard';
import { FileProcessorService } from './file-processor.service';
import { ProcessFileDto } from './dto/process-file.dto';

@Controller('api/file')
@UseGuards(ApiKeyGuard)
export class FileProcessorController {
  constructor(private readonly fileProcessorService: FileProcessorService) {}

  @Post('process')
  @HttpCode(HttpStatus.OK)
  async processFile(@Body() processFileDto: ProcessFileDto) {
    return await this.fileProcessorService.processFile(processFileDto);
  }
}
