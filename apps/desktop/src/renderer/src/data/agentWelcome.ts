import { builtinWelcomeShortcuts } from "../i18n/builtinLabels";
import { academicTreeT } from "../components/academic/academicTreeLabels";
import { createScopedTranslator } from "../i18n";
import type {
  AcademicAgentId,
  AgentTeamWorkspaceType,
  LibraryAgentDomain,
  LibraryAgentSkill,
  LongAgentId,
  MysteryAgentId,
  ScriptAgentWelcomeShortcuts,
  ScriptWorkspaceAgentId,
  ShortAgentWelcomeShortcuts,
  ShortWorkspaceAgentId,
  WorkspaceAgentId
} from "@deepwrite/contracts";
import {
  DEFAULT_ACADEMIC_AGENT_WELCOME_SHORTCUTS,
  DEFAULT_MYSTERY_AGENT_WELCOME_SHORTCUTS,
  DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS,
  DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS
} from "@deepwrite/contracts/renderer";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";

const t = createScopedTranslator("workspace");

export interface AgentWelcomeContent {
  title: string;
  description: string;
  questions: readonly [string, string, string];
}

export const DEFAULT_AGENT_WELCOME: AgentWelcomeContent = {
  get title() {
    return t("agentWelcome.startWithAWritingGoal");
  },
  get description() {
    return t("agentWelcome.tellMeWhatYouWantToWriteWeWill");
  },
  get questions(): readonly [string, string, string] {
    return [
      t("agentWelcome.helpMeClarifyMyWritingGoal"),
      t("agentWelcome.reviewTheCurrentManuscript"),
      t("agentWelcome.suggestWhatToWorkOnNext")
    ];
  }
};

export const SHORT_AGENT_WELCOME_CONTENT = {
  short: {
    get title() {
      return t("agentWelcome.startWithTheCurrentShortStoryStage");
    },
    get description() {
      return t("agentWelcome.iAmYourShortStoryAgentIHelpWith");
    },
    get questions() {
      return builtinWelcomeShortcuts("short");
    }
  }
} as const satisfies Record<ShortWorkspaceAgentId, AgentWelcomeContent>;

export const SCRIPT_AGENT_WELCOME_CONTENT = {
  script: {
    get title() {
      return t("agentWelcome.startWithTheCurrentScreenplayStage");
    },
    get description() {
      return t("agentWelcome.iAmYourScreenplayAgentIHelpWithCharacters");
    },
    get questions() {
      return builtinWelcomeShortcuts("script");
    }
  }
} as const satisfies Record<ScriptWorkspaceAgentId, AgentWelcomeContent>;

export const LIBRARY_AGENT_WELCOME_CONTENT = {
  skill: {
    get title() {
      return t("agentWelcome.startByCreatingASkill");
    },
    get description() {
      return t("agentWelcome.iManageYourSkillLibraryAndHelpCreateAnd");
    },
    get questions(): readonly [string, string, string] {
      return [
        t("agentWelcome.initializeTheLibraryIntroduction"),
        t("agentWelcome.createASkill"),
        t("agentWelcome.organizeASkill")
      ];
    }
  },
  material: {
    get title() {
      return t("agentWelcome.startByCreatingAMaterial");
    },
    get description() {
      return t("agentWelcome.iManageYourMaterialLibraryAndHelpCreateAnd");
    },
    get questions(): readonly [string, string, string] {
      return [
        t("agentWelcome.initializeTheLibraryIntroduction"),
        t("agentWelcome.createAMaterial"),
        t("agentWelcome.organizeAMaterial")
      ];
    }
  }
} as const satisfies Record<LibraryAgentDomain, AgentWelcomeContent>;

export const LONG_AGENT_WELCOME_CONTENT = {
  long: {
    get title() {
      return t("builtins.longWelcome");
    },
    get description() {
      return t("builtins.longDescription");
    },
    get questions() {
      return builtinWelcomeShortcuts("long");
    }
  }
} satisfies Record<LongAgentId, AgentWelcomeContent>;

export const ACADEMIC_AGENT_WELCOME_CONTENT = {
  academic: {
    get title() {
      return academicTreeT("academicWelcomeTitle");
    },
    get description() {
      return academicTreeT("academicWelcomeDesc");
    },
    get questions() {
      return builtinWelcomeShortcuts("academic");
    }
  }
} satisfies Record<AcademicAgentId, AgentWelcomeContent>;

export function resolveAgentWelcome(
  agentId:
    | WorkspaceAgentId
    | LongAgentId
    | AcademicAgentId
    | MysteryAgentId
    | undefined,
  libraryDomain?: LibraryAgentDomain,
  librarySkills?: readonly Pick<LibraryAgentSkill, "name">[],
  welcomeShortcuts?:
    | ShortAgentWelcomeShortcuts
    | ScriptAgentWelcomeShortcuts
    | readonly string[],
  workspaceType: AgentTeamWorkspaceType = "short"
): AgentWelcomeContent {
  if (agentId && workspaceType === "academic") {
    const base = ACADEMIC_AGENT_WELCOME_CONTENT[agentId as AcademicAgentId];
    if (base) {
      return withWelcomeShortcuts(
        base,
        welcomeShortcuts,
        DEFAULT_ACADEMIC_AGENT_WELCOME_SHORTCUTS
      );
    }
  }
  if (agentId && workspaceType === "mystery") {
    return withWelcomeShortcuts(
      {
        title: mysteryLabels("mysteryWelcomeTitle"),
        description: mysteryLabels("mysteryWelcomeDescription"),
        questions: DEFAULT_MYSTERY_AGENT_WELCOME_SHORTCUTS
      },
      welcomeShortcuts,
      DEFAULT_MYSTERY_AGENT_WELCOME_SHORTCUTS
    );
  }
  if (agentId && workspaceType === "script") {
    const base =
      SCRIPT_AGENT_WELCOME_CONTENT[agentId as ScriptWorkspaceAgentId];
    if (base)
      return withWelcomeShortcuts(
        base,
        welcomeShortcuts,
        DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS.script
      );
  }
  if (
    agentId &&
    (workspaceType === "long" || !(agentId in SHORT_AGENT_WELCOME_CONTENT))
  ) {
    const base = LONG_AGENT_WELCOME_CONTENT[agentId as LongAgentId];
    if (base) return base;
  }

  if (agentId) {
    const base =
      SHORT_AGENT_WELCOME_CONTENT[agentId as ShortWorkspaceAgentId] ??
      DEFAULT_AGENT_WELCOME;
    return withWelcomeShortcuts(
      base,
      welcomeShortcuts,
      DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.short
    );
  }

  if (libraryDomain) {
    const base = LIBRARY_AGENT_WELCOME_CONTENT[libraryDomain];
    if (!librarySkills?.length) {
      return base;
    }
    const questions = librarySkills.slice(0, 3).map((skill) => skill.name);
    while (questions.length < 3) {
      questions.push(base.questions[questions.length] ?? "");
    }
    return {
      ...base,
      questions: questions as [string, string, string]
    };
  }
  return DEFAULT_AGENT_WELCOME;
}

function withWelcomeShortcuts(
  base: AgentWelcomeContent,
  welcomeShortcuts?: readonly string[],
  defaults?: readonly string[]
): AgentWelcomeContent {
  // An unchanged built-in shortcut set is presentation metadata; customized text is content.
  if (
    defaults &&
    welcomeShortcuts?.every((value, index) => value === defaults[index]) &&
    welcomeShortcuts.length === defaults.length
  )
    return base;
  if (
    welcomeShortcuts?.length === 3 &&
    welcomeShortcuts.every(
      (value) => typeof value === "string" && value.trim().length > 0
    )
  ) {
    return {
      ...base,
      questions: [
        welcomeShortcuts[0]!.trim(),
        welcomeShortcuts[1]!.trim(),
        welcomeShortcuts[2]!.trim()
      ]
    };
  }
  return base;
}
