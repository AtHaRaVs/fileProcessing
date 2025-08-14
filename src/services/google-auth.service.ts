import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import type { OAuth2Client } from 'google-auth-library';
import { Credentials } from 'google-auth-library';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private oauth2Client: OAuth2Client;
  private readonly tokensFilePath = path.join(process.cwd(), 'tokens.json');

  constructor() {
    this.initializeOAuth();
  }

  private initializeOAuth() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    this.loadTokens();
  }

  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
  }

  async handleCallback(code: string): Promise<void> {
    try {
      const { tokens }: { tokens: Credentials } =
        await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);

      this.saveTokens(tokens);

      this.logger.log('OAuth tokens saved successfully');
    } catch (error) {
      this.logger.error('Error handling OAuth callback:', error);
      throw error;
    }
  }

  async getDriveInstance() {
    await this.refreshTokenIfNeeded();

    return google.drive({
      version: 'v3',
      auth: this.oauth2Client,
    });
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      this.saveTokens(credentials);
    } catch (error) {
      this.logger.error('Error refreshing token:', error);
      throw new Error(
        'Authentication required. Please re-authorize the application.',
      );
    }
  }

  private saveTokens(tokens: any): void {
    try {
      fs.writeFileSync(this.tokensFilePath, JSON.stringify(tokens, null, 2));
      this.logger.log('Tokens saved to file');
    } catch (error) {
      this.logger.error('Error saving tokens:', error);
    }
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokensFilePath)) {
        const tokens = JSON.parse(
          fs.readFileSync(this.tokensFilePath, 'utf8'),
        ) as Credentials;

        this.oauth2Client.setCredentials(tokens);
        this.logger.log('Tokens loaded from file');
      }
    } catch {
      this.logger.warn('No existing tokens found or error loading tokens');
    }
  }

  isAuthenticated(): boolean {
    const credentials = this.oauth2Client.credentials;
    return !!(
      credentials &&
      (credentials.access_token || credentials.refresh_token)
    );
  }

  extractFolderIdFromLink(driveLink: string): string {
    const patterns = [
      /\/folders\/([a-zA-Z0-9-_]+)/,
      /id=([a-zA-Z0-9-_]+)/,
      /^([a-zA-Z0-9-_]+)$/,
    ];

    for (const pattern of patterns) {
      const match = driveLink.match(pattern);
      if (match) {
        return match[1];
      }
    }

    throw new Error('Invalid Google Drive folder link format');
  }
}
