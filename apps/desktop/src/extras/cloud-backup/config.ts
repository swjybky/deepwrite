import { DEEPWRITE_PUBLIC_DATA_API_BASE_URL } from "../../main/deepwrite-public-data-config";

export interface CloudBackupApiConfig {
  baseUrl: string;
}
export function loadCloudBackupApiConfig(): CloudBackupApiConfig | null {
  const url = new URL(DEEPWRITE_PUBLIC_DATA_API_BASE_URL);
  if (
    url.hostname === "deepwrite-public-data.invalid" ||
    url.protocol !== "https:"
  )
    return null;
  return { baseUrl: DEEPWRITE_PUBLIC_DATA_API_BASE_URL };
}
