import {
  type CatalogInstallMarketplaceSkillContentResult,
  type CatalogSnapshot,
  type MarketplaceInstallPackage
} from "@deepwrite/contracts";

export type MarketplaceFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface SecureStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface StoredMarketplaceSession {
  version: 1;
  encryptedToken: string;
  expiresAt?: string;
}

export interface MarketplaceClientOptions {
  baseUrl?: string;
  fetcher?: MarketplaceFetcher;
  secureStorage?: SecureStorageLike;
  now?: () => number;
  loadCatalogSnapshot?: () => Promise<CatalogSnapshot>;
  installPackage?: (
    input: MarketplaceInstallPackage
  ) => Promise<CatalogInstallMarketplaceSkillContentResult>;
}
