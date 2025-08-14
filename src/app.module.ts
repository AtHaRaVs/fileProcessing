import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FileProcessorModule } from './modules/file-processor/file-processor.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    FileProcessorModule,
  ],
})
export class AppModule {}
