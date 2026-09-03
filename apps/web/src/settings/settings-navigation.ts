export const settingsSectionIds = [
  "general",
  "agent",
  "harnesses",
  "models",
  "metrics",
  "integrations",
  "permissions",
  "proof-trust",
  "team-policy",
  "diagnostics",
] as const;

export type SettingsSectionId = (typeof settingsSectionIds)[number];

export interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: string;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

export const settingsNavigation: SettingsNavGroup[] = [
  {
    label: "General",
    items: [{
      id: "general",
      label: "General",
      description: "Theme and local device defaults.",
      icon: "palette",
    }],
  },
  {
    label: "Agent",
    items: [{
      id: "agent",
      label: "Behavior",
      description: "Mode defaults and approval policy for new tasks.",
      icon: "sparkle",
    }],
  },
  {
    label: "Runtimes",
    items: [
      {
        id: "harnesses",
        label: "Harnesses",
        description: "Installed coding agents, models, and conformance on this device.",
        icon: "terminal",
      },
      {
        id: "models",
        label: "Model providers",
        description: "Direct API connections outside installed harnesses.",
        icon: "sparkle",
      },
      {
        id: "metrics",
        label: "Harness metrics",
        description: "Opt-in local telemetry to improve harness defaults over time.",
        icon: "sparkle",
      },
    ],
  },
  {
    label: "Integrations",
    items: [{
      id: "integrations",
      label: "MCP servers",
      description: "Connect external tools through the Model Context Protocol.",
      icon: "boxes",
    }],
  },
  {
    label: "Security",
    items: [
      {
        id: "permissions",
        label: "Permissions",
        description: "Remembered approval rules and audit exports.",
        icon: "lock",
      },
      {
        id: "proof-trust",
        label: "Proof & trust",
        description: "Signing identity, verification, and trusted signers.",
        icon: "lock",
      },
      {
        id: "team-policy",
        label: "Team policy",
        description: "Signed organization policy bundles for governed approvals.",
        icon: "lock",
      },
    ],
  },
  {
    label: "Support",
    items: [{
      id: "diagnostics",
      label: "Diagnostics",
      description: "Recovery exports without project content or credentials.",
      icon: "life-buoy",
    }],
  },
];

export function settingsNavItem(id: SettingsSectionId): SettingsNavItem {
  for (const group of settingsNavigation) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item;
  }
  return settingsNavigation[0]!.items[0]!;
}

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (settingsSectionIds as readonly string[]).includes(value);
}
