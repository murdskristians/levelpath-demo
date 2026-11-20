import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthedRequest } from './auth.guard.js';

/**
 * Approver-only routes: `@UseGuards(ApproverGuard)`. It runs after the global
 * AuthGuard, which resolved the caller's role from the database, and before any pipe
 * or handler. So a requester gets the same 403 whatever the body or the id: the
 * answer reveals nothing about the request they named.
 */
@Injectable()
export class ApproverGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthedRequest>().authUser;
    if (!user) {
      // A programming error, not a client one: the route is @Public() but needs an approver.
      throw new Error('ApproverGuard needs a route the AuthGuard protects');
    }
    if (user.role !== 'approver') throw new ForbiddenException();
    return true;
  }
}
