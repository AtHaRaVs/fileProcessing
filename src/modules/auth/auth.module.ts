import { Module } from '@nestjs/common';
import { GoogleAuthService } from '../../services/google-auth.service';
import { AuthController } from './auth-controller';

@Module({
  controllers: [AuthController],
  providers: [GoogleAuthService],
  exports: [GoogleAuthService],
})
export class AuthModule {}
