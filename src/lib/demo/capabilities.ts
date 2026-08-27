export type DemoCapability =
  | "activityMutation"
  | "alertMutation"
  | "assistant"
  | "connectionMutation"
  | "accountDeletion"
  | "export"
  | "liveMeter"
  | "notificationMutation"
  | "pushSubscription"
  | "sync";

export type DemoCapabilityDecision = {
  allowed: boolean;
  reason?: string;
};

// One policy for every demo entry point, shared by client and server code.
// Demo-local Activities and notification read state are intentionally
// interactive; reseeding restores their canonical state. Anything that can
// reach LiveMopay, external push services, hardware, or destroy the shared
// account remains blocked.
export const DEMO_CAPABILITIES: Record<DemoCapability, DemoCapabilityDecision> = {
  activityMutation: { allowed: true },
  alertMutation: { allowed: false, reason: "Demo alert settings are fixed for the shared walkthrough." },
  assistant: { allowed: true },
  connectionMutation: { allowed: false, reason: "Demo data is not connected to LiveMopay." },
  accountDeletion: { allowed: false, reason: "The shared demo account cannot be deleted." },
  export: { allowed: true },
  liveMeter: { allowed: false, reason: "Live monitoring requires a physical NewinMeter device." },
  notificationMutation: { allowed: true },
  pushSubscription: { allowed: false, reason: "Push notifications are disabled for the shared demo account." },
  sync: { allowed: false, reason: "Demo data does not sync with LiveMopay." }
};

export function demoCapability(capability: DemoCapability): DemoCapabilityDecision {
  return DEMO_CAPABILITIES[capability];
}

export function demoCapabilityBlocked(isDemo: boolean, capability: DemoCapability): boolean {
  return isDemo && !demoCapability(capability).allowed;
}
