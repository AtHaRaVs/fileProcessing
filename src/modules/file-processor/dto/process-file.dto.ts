import { IsString, IsUrl, IsNotEmpty } from 'class-validator';
export class ProcessFileDto {
  @IsString()
  @IsUrl()
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  driveFolderLink: string;
}
