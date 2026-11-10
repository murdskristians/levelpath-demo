import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  status(): 'ok' {
    return 'ok';
  }
}
