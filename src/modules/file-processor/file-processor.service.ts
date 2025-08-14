import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import { GoogleAuthService } from '../../services/google-auth.service';
import { ProcessFileDto } from './dto/process-file.dto';
import type { Readable } from 'stream';
import { drive_v3 } from 'googleapis';
import { execSync } from 'node:child_process';
import type { ReadStream } from 'node:fs';

interface UploadProgressEvent {
  bytesRead: number;
}

@Injectable()
export class FileProcessorService {
  private readonly logger = new Logger(FileProcessorService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp');

  constructor(private readonly googleAuthService: GoogleAuthService) {
    this.ensureTempDirectory();
  }

  async processFile(
    processFileDto: ProcessFileDto,
  ): Promise<{ message: string; uploadedFiles: string[] }> {
    if (!this.googleAuthService.isAuthenticated()) {
      throw new UnauthorizedException(
        'Google Drive not authorized. Please visit /auth/google to authorize the application.',
      );
    }

    const { fileUrl, driveFolderLink } = processFileDto;
    const driveFolderId =
      this.googleAuthService.extractFolderIdFromLink(driveFolderLink);

    let zipFilePath: string = '';
    let extractedDir: string = '';

    try {
      this.logger.log(`📥 Starting download from: ${fileUrl}`);
      zipFilePath = await this.downloadFile(fileUrl);

      this.logger.log(`📦 Extracting ZIP file: ${zipFilePath}`);
      extractedDir = await this.extractZipFile(zipFilePath);

      this.logger.log(
        `☁️ Uploading files to Google Drive folder: ${driveFolderId}`,
      );
      const uploadedFiles = await this.uploadToGoogleDrive(
        extractedDir,
        driveFolderId,
      );

      this.logger.log(
        `✅ Successfully processed ${uploadedFiles.length} files`,
      );

      return {
        message: `Successfully processed and uploaded ${uploadedFiles.length} files to Google Drive`,
        uploadedFiles,
      };
    } catch (error: unknown) {
      this.logger.error('❌ Error processing file:', error);

      if (
        error instanceof Error &&
        (error.message.includes('invalid_grant') ||
          error.message.includes('unauthorized'))
      ) {
        throw new UnauthorizedException(
          'Authentication expired. Please visit /auth/google to re-authorize.',
        );
      }

      throw error;
    } finally {
      await this.cleanup(zipFilePath, extractedDir);
    }
  }

  private async downloadFile(url: string): Promise<string> {
    const fileName = `download_${Date.now()}.zip`;
    const filePath = path.join(this.tempDir, fileName);

    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 300000,
      });
      const stream = response.data as Readable;

      const writer = fs.createWriteStream(filePath);
      stream.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          this.logger.log(`File downloaded successfully: ${filePath}`);
          resolve(filePath);
        });
        writer.on('error', reject);
      });
    } catch (error: unknown) {
      let message = 'Unknown error';

      if (error instanceof Error) {
        message = error.message;
      }

      this.logger.error(`Failed to download file from ${url}:`, message);
      throw new Error(`Download failed: ${message}`);
    }
  }

  private async extractZipFile(zipFilePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const extractDir = path.join(this.tempDir, `extracted_${Date.now()}`);
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(extractDir, true);
        this.logger.log(`ZIP file extracted to: ${extractDir}`);
        resolve(extractDir);
      } catch (error: unknown) {
        let message = 'An unknown error occurred during extraction.';
        if (error instanceof Error) {
          message = error.message;
        }
        this.logger.error('Failed to extract ZIP file:', message);
        reject(new Error(message));
      }
    });
  }

  private async uploadToGoogleDrive(
    directory: string,
    folderId: string,
  ): Promise<string[]> {
    const drive = await this.googleAuthService.getDriveInstance();
    const uploadedFiles: string[] = [];

    try {
      const files = this.getAllFiles(directory);

      for (const filePath of files) {
        const fileName = path.basename(filePath);
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';
        const fileSize = fs.statSync(filePath).size;

        this.logger.log(
          `Uploading: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`,
        );

        const fileMetadata = {
          name: fileName,
          parents: [folderId],
        };

        const media = {
          mimeType: mimeType,
          body: fs.createReadStream(filePath),
        };

        const response = await this.uploadWithRetry(
          drive,
          fileMetadata,
          media,
          fileName,
          fileSize,
        );

        uploadedFiles.push(response.name!);
        this.logger.log(`✅ Uploaded: ${fileName} (ID: ${response.id})`);
      }

      return uploadedFiles;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to upload files to Google Drive:', message);
      throw new Error(`Upload failed: ${message}`);
    }
  }

  private async uploadWithRetry(
    drive: drive_v3.Drive,
    fileMetadata: drive_v3.Schema$File,
    media: { mimeType: string; body: NodeJS.ReadableStream },
    fileName: string,
    fileSize: number,
    maxRetries = 3,
  ): Promise<drive_v3.Schema$File> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await drive.files.create(
          {
            requestBody: fileMetadata,
            media,
            fields: 'id,name',
          },
          {
            onUploadProgress: (evt: UploadProgressEvent) => {
              const progress = Math.round((evt.bytesRead / fileSize) * 100);
              process.stdout.write(
                `Uploading ${fileName}: ${progress}% complete\r`,
              );
            },
          },
        );
        process.stdout.write('\n');
        return res.data;
      } catch (error: unknown) {
        process.stdout.write('\n');
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          `Upload attempt ${attempt}/${maxRetries} failed for ${fileName}: ${message}`,
        );

        if (attempt === maxRetries) {
          throw error;
        }

        const waitTime = Math.pow(2, attempt) * 1000;
        this.logger.log(`Retrying in ${waitTime / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));

        if ('path' in media.body) {
          media.body = fs.createReadStream((media.body as ReadStream).path);
        } else {
          throw new Error(
            `media.body is not a ReadStream for file: ${fileName}`,
          );
        }
      }
    }
    throw new Error(`Unexpected upload failure for ${fileName}`);
  }
  private ensureTempDirectory(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private async cleanup(
    zipFilePath?: string,
    extractedDir?: string,
  ): Promise<void> {
    try {
      if (zipFilePath && fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
        this.logger.log(`✅ Cleaned up ZIP file: ${zipFilePath}`);
      }

      if (extractedDir && fs.existsSync(extractedDir)) {
        await this.removeDirectoryRecursive(extractedDir);
        this.logger.log(`✅ Cleaned up extracted directory: ${extractedDir}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️ Failed to cleanup temporary files: ${message}`);
    }
  }

  private async removeDirectoryRecursive(dirPath: string): Promise<void> {
    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          await this.removeDirectoryRecursive(fullPath);
        } else {
          try {
            fs.unlinkSync(fullPath);
          } catch (unlinkError) {
            const msg =
              unlinkError instanceof Error
                ? unlinkError.message
                : String(unlinkError);
            this.logger.warn(`Could not delete file: ${fullPath} — ${msg}`);

            if (process.platform === 'win32') {
              try {
                execSync(`del /f /q "${fullPath}"`, { stdio: 'ignore' });
              } catch (cmdError: unknown) {
                const msg =
                  cmdError instanceof Error
                    ? cmdError.message
                    : String(cmdError);
                this.logger.warn(
                  `Force delete also failed for: ${fullPath} — ${msg}`,
                );
              }
            }
          }
        }
      }

      fs.rmdirSync(dirPath);
    } catch (error) {
      this.logger.error(`Error removing directory ${dirPath}:`, error);
      throw error;
    }
  }

  private getAllFiles(dir: string): string[] {
    const files: string[] = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }
}
