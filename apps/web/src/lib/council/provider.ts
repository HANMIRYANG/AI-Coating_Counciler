// Provider adapter interface.
//
// All real providers (OpenAI / Anthropic / Gemini) and the mock provider must
// implement this interface so the orchestrator never has to special-case any
// vendor API.

import type {
  CritiqueInput,
  InitialOpinionInput,
  ProviderCallOptions,
  ProviderId,
  SynthesisInput,
} from "./types";
import type { ProviderCritique, ProviderOpinion, FinalAnswer } from "./schemas";

export interface AiProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly model: string;

  generateInitialOpinion(
    input: InitialOpinionInput,
    options: ProviderCallOptions,
  ): Promise<ProviderOpinion>;

  generateCritique(
    input: CritiqueInput,
    options: ProviderCallOptions,
  ): Promise<ProviderCritique>;

  generateSynthesis?(
    input: SynthesisInput,
    options: ProviderCallOptions,
  ): Promise<FinalAnswer>;

  healthCheck?(): Promise<boolean>;
}
