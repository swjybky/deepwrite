import { shallowRef } from "vue";
import type {
  AgentTeamWorkspaceType,
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind
} from "@deepwrite/contracts";

export type BookLibraryBindingChange =
  | { domain: "skill"; ids: string[]; linksByKind: LinkedSkillIdsByKind }
  | { domain: "material"; ids: string[]; linksByKind: LinkedMaterialIdsByKind };

export interface BookBindingsTarget {
  bookId: string;
  title: string;
  workspaceType: AgentTeamWorkspaceType;
  initialSkills?: LinkedSkillIdsByKind | undefined;
  initialMaterials?: LinkedMaterialIdsByKind | undefined;
  initialSkillIds?: readonly string[] | undefined;
  initialMaterialIds?: readonly string[] | undefined;
  saveLibrary(change: BookLibraryBindingChange): Promise<boolean>;
  close?(): void;
}

export const bookBindingsTarget = shallowRef<BookBindingsTarget | null>(null);
