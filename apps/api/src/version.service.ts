import { readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);
  private cached?: string;

  version(): string {
    if (this.cached === undefined) {
      try {
        // apps/api/package.json is one level up from both src/ and dist/.
        const pkg = JSON.parse(
          readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as {
          version: string;
        };
        this.cached = pkg.version;
      } catch (err) {
        this.logger.error('Could not read the version from package.json', err);
        throw err;
      }
    }
    return this.cached;
  }
}
