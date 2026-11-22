import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  suggestionRequestSchema,
  type SuggestionRequest,
  type SuggestionResponse,
} from '@levelpath/shared';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../validation/zod-validation.pipe.js';
import { SuggestionsService } from './suggestions.service.js';

// POST /purchase-requests/suggestion (requirement 7). Any signed-in caller, no role
// guard. It writes nothing; whatever the LLM does, the answer is 200 with a suggestion
// or with `null`. Only a bad body (400) or no caller (401) is an error.
@Controller('purchase-requests')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Post('suggestion')
  @HttpCode(200)
  async suggest(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(suggestionRequestSchema)) body: SuggestionRequest,
  ): Promise<SuggestionResponse> {
    return { suggestion: await this.suggestions.suggest(user, body.description) };
  }
}
