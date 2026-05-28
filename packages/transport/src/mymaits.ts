export type MyMaitsLiteHost = 'loom_teacher';

export interface MyMaitsLiteHostContract {
  host: MyMaitsLiteHost;
  label: string;
  runtimeEntitlement: 'mymaits_lite_runtime';
  hostEntitlements: string[];
  mode: 'headless';
  canLaunchStandalone: false;
  canChatDirectly: false;
  role: string;
  outputContract: string;
}

export const MY_MAITS_LITE_RUNTIME_ENTITLEMENT = 'mymaits_lite_runtime' as const;

export const MY_MAITS_LITE_HOST_CONTRACTS: Record<MyMaitsLiteHost, MyMaitsLiteHostContract> = {
  loom_teacher: {
    host: 'loom_teacher',
    label: 'My Maits Lite Teacher Agent',
    runtimeEntitlement: MY_MAITS_LITE_RUNTIME_ENTITLEMENT,
    hostEntitlements: ['loom', 'loom.teacher_agent'],
    mode: 'headless',
    canLaunchStandalone: false,
    canChatDirectly: false,
    role: 'Plans lessons, feedback, revision prompts, and learner diagnostics for Loom.',
    outputContract: 'teacher_plan',
  },
};
