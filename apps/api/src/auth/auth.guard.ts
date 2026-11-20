import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../db/database.service.js';
import type { AuthUser } from './auth-user.js';
import { IS_PUBLIC } from './public.decorator.js';

/** The request as the guard leaves it for @CurrentUser(). */
export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  authUser?: AuthUser;
}

/**
 * The stub login (a dev stand-in, NOT authentication: anyone can send any id).
 *
 * A guard is a class Nest runs before a route handler; it lets the request through
 * or throws. This one is global (AuthModule registers it as APP_GUARD), so every
 * route needs X-User-Id unless it is marked @Public(). The header must be one UUID
 * of an existing user; it is resolved to that user's id, tenant and role, which the
 * route reads with @CurrentUser(). A missing, malformed or unknown id gets the same
 * 401, so the response never tells whether a user exists.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers['x-user-id'];
    const user = typeof header === 'string' ? await this.db.resolveUser(header) : undefined;
    if (!user) throw new UnauthorizedException();
    request.authUser = user;
    return true;
  }
}
