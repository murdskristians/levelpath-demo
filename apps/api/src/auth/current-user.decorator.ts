import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user.js';
import type { AuthedRequest } from './auth.guard.js';

/**
 * The caller the AuthGuard resolved: `get(@CurrentUser() user: AuthUser)`.
 * A route's tenant comes from here, never from a body, query string or path.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().authUser;
    if (!user) {
      // A programming error, not a client one: the route is @Public() but asks for a user.
      throw new Error('@CurrentUser() needs a route the AuthGuard protects');
    }
    return user;
  },
);
