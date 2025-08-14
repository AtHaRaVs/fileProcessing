import { Module } from '@nestjs/common';
import { FileProcessorController } from './file-processor.controller';
import { FileProcessorService } from './file-processor.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FileProcessorController],
  providers: [FileProcessorService],
})
export class FileProcessorModule {}
