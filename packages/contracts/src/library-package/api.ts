import type {
  ChooseLibraryPackageSourceInput,
  ChooseLibraryPackageSourceResult,
  ExportLibraryPackageInput,
  ExportLibraryPackageResult,
  ImportLibraryPackageInput,
  ImportLibraryPackageResult
} from "./commands";

/** `window.deepwrite.libraryPackage`: every call is validated both ways. */
export interface LibraryPackageApi {
  /** Reads the library or group, asks for a folder, writes `名称.zip`. */
  exportPackage(
    input: ExportLibraryPackageInput
  ): Promise<ExportLibraryPackageResult>;
  /** Picks a ZIP or folder and recognises it; null when cancelled. */
  chooseSource(
    input: ChooseLibraryPackageSourceInput
  ): Promise<ChooseLibraryPackageSourceResult | null>;
  importPackage(
    input: ImportLibraryPackageInput
  ): Promise<ImportLibraryPackageResult>;
  discardPreview(input: { previewId: string }): Promise<void>;
}
