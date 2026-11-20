import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:isPublic';

/**
 * Marks a controller or route as reachable without X-User-Id. Everything else is
 * protected by the global AuthGuard, so a new route is closed until someone opens it.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
