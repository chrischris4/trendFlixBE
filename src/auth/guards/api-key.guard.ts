import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-admin-key'];
    const expected = this.config.get<string>('ADMIN_API_KEY');
    if (!key || key !== expected) throw new UnauthorizedException();
    return true;
  }
}
