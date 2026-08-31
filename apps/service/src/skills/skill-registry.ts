import { createHash } from "node:crypto";
import type { AgentSkill } from "@vraxis/agent-v";
import {
  discoverAgentSkillInventory,
  type AgentSkillInventory,
  type InventoriedAgentSkill,
} from "@vraxis/agent-v/node";
import type { SkillReference, SkillScope, SkillSummary } from "@vraxis/code-contracts";

export type SkillInventoryDiscovery = typeof discoverAgentSkillInventory;

export interface ResolvedSkill {
  reference: SkillReference;
  skill: AgentSkill;
}

function publicId(skill: InventoriedAgentSkill): string {
  return createHash("sha256").update(skill.key).digest("hex").slice(0, 24);
}

function readySkills(inventory: AgentSkillInventory): InventoriedAgentSkill[] {
  return inventory.skills.filter((skill) => skill.status === "found" && skill.agentVCompatible && skill.loaded);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function summary(skill: InventoriedAgentSkill): SkillSummary {
  return {
    id: publicId(skill),
    name: skill.name,
    description: skill.description,
    version: skill.version,
    scopes: unique(skill.exposures.map((exposure) => exposure.scope)) as SkillScope[],
    runtimes: [...skill.runtimes],
  };
}

export class SkillRegistry {
  constructor(private readonly discover: SkillInventoryDiscovery = discoverAgentSkillInventory) {}

  async summaries(projectPath: string): Promise<SkillSummary[]> {
    const inventory = await this.discover({ cwd: projectPath });
    return readySkills(inventory).map(summary);
  }

  async resolve(projectPath: string, skillIds: readonly string[] = []): Promise<ResolvedSkill[]> {
    if (!skillIds.length) return [];
    const inventory = await this.discover({ cwd: projectPath });
    const skills = new Map(readySkills(inventory).map((skill) => [publicId(skill), skill]));
    return skillIds.map((id) => {
      const inventoried = skills.get(id);
      if (!inventoried?.loaded) {
        throw new TypeError("An attached skill is no longer available. Remove it from the composer and try again.");
      }
      return {
        reference: { id, name: inventoried.name, version: inventoried.version },
        skill: inventoried.loaded.skill,
      };
    });
  }
}
