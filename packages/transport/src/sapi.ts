export type SapiPlannerProvider = 'lm_studio' | 'ollama' | 'external_api' | 'my_maits_internal';

export interface AiDirectorSapiPlannerContract {
  host: 'ai_director';
  label: 'AI Director SAPI Planner';
  entitlement: 'ai_director.planner';
  providers: SapiPlannerProvider[];
  plannedProviders: SapiPlannerProvider[];
  outputContract: 'shot_plan';
  mode: 'provider_routed';
}

export const AI_DIRECTOR_SAPI_PLANNER_CONTRACT: AiDirectorSapiPlannerContract = {
  host: 'ai_director',
  label: 'AI Director SAPI Planner',
  entitlement: 'ai_director.planner',
  providers: ['lm_studio', 'ollama', 'external_api'],
  plannedProviders: ['my_maits_internal'],
  outputContract: 'shot_plan',
  mode: 'provider_routed',
};
