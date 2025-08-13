import { Injectable, Logger } from '@nestjs/common';
import { drive_v3, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private drive: drive_v3.Drive;

  async onModuleInit() {
    await this.initializeGoogleDrive();
  }

  private async initializeGoogleDrive() {
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });

      const authClient = (await auth.getClient()) as OAuth2Client;

      this.drive = google.drive({ version: 'v3', auth: authClient });

      this.logger.log('Google Drive API initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Google Drive API', error);
      throw error;
    }
  }

  getDriveInstance(): drive_v3.Drive {
    return this.drive;
  }

  extractFolderIdFromLink(driveLink: string): string {
    const match = driveLink.match(/folders\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      throw new Error('Invalid Google Drive folder link');
    }
    return match[1];
  }
}
