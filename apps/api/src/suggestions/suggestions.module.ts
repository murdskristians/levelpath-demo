import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { createSuggestionProvider, llmConfigFromEnv } from './llm-config.js';
import {
  DEFAULT_SUGGESTION_DEADLINE_MS,
  SUGGESTION_DEADLINE_MS,
  SUGGESTION_PROVIDER,
} from './suggestion-provider.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsService } from './suggestions.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [SuggestionsController],
  providers: [
    // Read at startup: a bad LLM_PROVIDER or a missing key throws here, so the API
    // never starts listening (criterion 13).
    {
      provide: SUGGESTION_PROVIDER,
      useFactory: () => createSuggestionProvider(llmConfigFromEnv()),
    },
    { provide: SUGGESTION_DEADLINE_MS, useValue: DEFAULT_SUGGESTION_DEADLINE_MS },
    SuggestionsService,
  ],
})
export class SuggestionsModule {}
