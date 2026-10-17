/** Stable errors shared by Main credential storage and localized UI feedback. */
export type SecureStorageErrorCode =
  | "secure_storage.unavailable"
  | "secure_storage.encrypt_failed"
  | "secure_storage.decrypt_failed";
