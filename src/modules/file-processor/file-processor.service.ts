import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import { GoogleAuthService } from '../../services/google-auth.service';
import { ProcessFileDto } from './dto/process-file.dto';
import { Readable } from 'stream';

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
    const { fileUrl, driveFolderLink } = processFileDto;
    const driveFolderId =
      this.googleAuthService.extractFolderIdFromLink(driveFolderLink);

    let zipFilePath: string | undefined;
    let extractedDir: string | undefined;

    try {
      this.logger.log(`Starting download from: ${fileUrl}`);
      zipFilePath = await this.downloadFile(fileUrl);

      this.logger.log(`Extracting ZIP file: ${zipFilePath}`);
      extractedDir = await this.extractZipFile(zipFilePath);

      this.logger.log(
        `Uploading files to Google Drive folder: ${driveFolderId}`,
      );
      const uploadedFiles = await this.uploadToGoogleDrive(
        extractedDir,
        driveFolderId,
      );

      this.logger.log(`Successfully processed ${uploadedFiles.length} files`);

      return {
        message: `Successfully processed and uploaded ${uploadedFiles.length} files to Google Drive`,
        uploadedFiles,
      };
    } catch (error) {
      this.logger.error('Error processing file:', error);

      if (error instanceof Error) {
        throw new BadRequestException(
          `Failed to process file: ${error.message}`,
        );
      }
      throw new BadRequestException('Failed to process file: Unknown error');
    } finally {
      this.cleanup(zipFilePath, extractedDir);
    }
  }

  private async downloadFile(url: string): Promise<string> {
    const fileName = `download_${Date.now()}.zip`;
    const filePath = path.join(this.tempDir, fileName);

    try {
      const response: AxiosResponse<Readable> = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 300000,
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          this.logger.log(`File downloaded successfully: ${filePath}`);
          resolve(filePath);
        });
        writer.on('error', reject);
      });
    } catch (error: unknown) {
      this.logger.error(`Failed to download file from ${url}:`, error);

      if (error instanceof Error) {
        throw new Error(`Download failed: ${error.message}`);
      }
      throw new Error('Download failed: Unknown error');
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
        this.logger.error(`Failed to extract ZIP file:`, error);
        reject(error instanceof Error ? error : new Error('Unknown error'));
      }
    });
  }

  private async uploadToGoogleDrive(
    directory: string,
    folderId: string,
  ): Promise<string[]> {
    const drive = this.googleAuthService.getDriveInstance();
    const uploadedFiles: string[] = [];

    try {
      const files = this.getAllFiles(directory);

      for (const filePath of files) {
        const fileName = path.basename(filePath);
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';

        const fileMetadata = {
          name: fileName,
          parents: [folderId],
        };

        const media = {
          mimeType: mimeType,
          body: fs.createReadStream(filePath),
        };

        const response = await drive.files.create({
          requestBody: fileMetadata,
          media: media,
          fields: 'id,name',
        });

        uploadedFiles.push(response.data.name ?? '');
        this.logger.log(`Uploaded file: ${fileName} (ID: ${response.data.id})`);
      }

      return uploadedFiles;
    } catch (error: unknown) {
      this.logger.error('Failed to upload files to Google Drive:', error);

      if (error instanceof Error) {
        throw new Error(`Upload failed: ${error.message}`);
      }

      throw new Error('Upload failed: Unknown error');
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

  private ensureTempDirectory(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private cleanup(zipFilePath?: string, extractedDir?: string): void {
    try {
      if (zipFilePath && fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
        this.logger.log(`Cleaned up ZIP file: ${zipFilePath}`);
      }

      if (extractedDir && fs.existsSync(extractedDir)) {
        fs.rmSync(extractedDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up extracted directory: ${extractedDir}`);
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup temporary files:', error);
    }
  }
}
