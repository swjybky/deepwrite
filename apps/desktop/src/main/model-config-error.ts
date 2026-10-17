import { SecureStorageError } from "./secure-storage";

export function modelConfigErrorCode(error: unknown, fallback: string): string {
  if (error instanceof SecureStorageError) return error.code;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM") return "models.permission_denied";
  if (code === "ENOSPC" || code === "EDQUOT") return "models.disk_full";
  return fallback;
}
