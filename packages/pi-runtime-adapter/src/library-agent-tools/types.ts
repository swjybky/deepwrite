import {
  type LibraryAgentDomain,
  type LibraryAgentWorkspaceSnapshot,
  type LibraryAgentProfile,
  type AgentWriteApprovalMode,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

export type LibraryDomain = LibraryAgentDomain;

export type LibraryAgentToolDetails =
  | { kind: "none" }
  | {
      kind: "library-overview-mutation";
      operation: "edit-overview";
      domain: LibraryDomain;
      libraryId: string;
      documentId: string;
      title: string;
      text: string;
      baseRevision: string;
      baseProjectRevision?: number;
      summary: string;
    }
  | {
      kind: "library-entry-mutation";
      operation: "create";
      creationId?: string;
      domain: LibraryDomain;
      libraryId: string;
      stageId: string;
      title: string;
      text: string;
      baseRevision: string;
      baseProjectRevision?: number;
      summary: string;
    }
  | {
      kind: "library-entry-mutation";
      operation: "edit";
      domain: LibraryDomain;
      libraryId: string;
      entryId: string;
      documentId: string;
      stageId: string;
      title: string;
      text: string;
      baseRevision: string;
      baseProjectRevision?: number;
      summary: string;
    };

export interface BuildLibraryAgentToolsInput {
  workspace: LibraryAgentWorkspaceSnapshot;
  sharedState?: LibraryAgentToolSharedState;
  profile: LibraryAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
}

export interface LibraryEntryShape {
  id?: string;
  entryId?: string;
  documentId?: string;
  stageId?: string;
  title?: string;
  content?: string;
  body?: string;
  revision?: string;
  truncated?: boolean;
  originalLength?: number;
  readOnly?: boolean;
  sourceLibraryId?: string;
  sourceLibraryTitle?: string;
}

export interface LibraryReadableLibraryShape {
  libraryId?: string;
  id?: string;
  title?: string;
  kind?: string;
}

export interface LibraryWorkspaceShape {
  id?: string;
  libraryId?: string;
  domain?: LibraryDomain;
  title?: string;
  kind?: string;
  materialKind?: string;
  skillKind?: string;
  readOnly?: boolean;
  isReadOnly?: boolean;
  projectRevision?: number;
  baseProjectRevision?: number;
  overview?: string;
  overviewDocumentId?: string;
  overviewRevision?: string;
  overviewTruncated?: boolean;
  overviewOriginalLength?: number;
  omittedEntryCount?: number;
  allowedStageIds?: readonly string[];
  stageIds?: readonly string[];
  groupId?: string;
  groupTitle?: string;
  readableLibraries?: readonly LibraryReadableLibraryShape[];
  entries?: readonly LibraryEntryShape[];
}

export interface LibraryProfileShape {
  id?: string;
  domain?: LibraryDomain;
  readOnly?: boolean;
}

export interface MutableLibraryEntry {
  entryId: string;
  documentId: string;
  stageId: string;
  title: string;
  content: string;
  revision: string;
  truncated: boolean;
  originalLength?: number;
  readOnly: boolean;
  pendingCreate: boolean;
  sourceLibraryId: string;
  sourceLibraryTitle: string;
  isCurrentLibrary: boolean;
}

export interface MutableLibraryOverview {
  documentId: string;
  content: string;
  revision: string;
  truncated: boolean;
  originalLength?: number;
}

export interface LibraryAgentToolSharedState {
  entries: MutableLibraryEntry[];
  overview: MutableLibraryOverview;
}
