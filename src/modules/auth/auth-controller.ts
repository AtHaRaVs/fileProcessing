import { Controller, Get, Query, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { GoogleAuthService } from '../../services/google-auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly googleAuthService: GoogleAuthService) {}

  @Get('google')
  googleAuth(@Res() res: Response) {
    const authUrl = this.googleAuthService.getAuthUrl();
    return res.redirect(authUrl);
  }

  @Get('google/callback')
  async googleAuthRedirect(@Query('code') code: string, @Res() res: Response) {
    try {
      if (!code) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: 'Authorization code not provided',
        });
      }

      await this.googleAuthService.handleCallback(code);

      return res.json({
        message:
          'Google OAuth authorization successful! You can now use the file processing API.',
        success: true,
      });
    } catch (error: unknown) {
      let message = 'Unknown error';

      if (error instanceof Error) {
        message = error.message;
      }

      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'OAuth authorization failed',
        details: message,
      });
    }
  }

  @Get('status')
  getAuthStatus() {
    const authenticated = this.googleAuthService.isAuthenticated();
    return {
      authenticated,
      message: authenticated
        ? 'Application is authenticated with Google Drive'
        : 'Application needs Google Drive authorization',
    };
  }
}
