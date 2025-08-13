import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

interface ApiRequest {
  headers: {
    'x-api-key'?: string;
    authorization?: string;
  };
  query: {
    apiKey?: string;
  };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly validApiKeys = process.env.API_KEYS?.split(',') || [
    'your-default-api-key',
  ];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    if (!apiKey || !this.validApiKeys.includes(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  private extractApiKey(request: ApiRequest): string | undefined {
    return (
      request.headers['x-api-key'] ||
      request.headers['authorization']?.replace('Bearer ', '') ||
      request.query.apiKey
    );
  }
}
