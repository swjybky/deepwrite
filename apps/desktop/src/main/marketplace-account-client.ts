import {
  MarketplaceLoginInputSchema,
  MarketplaceRegisterInputSchema,
  MarketplaceSessionSchema,
  type MarketplaceLoginInput,
  type MarketplaceRegisterInput,
  type MarketplaceSession,
  type MarketplaceUser
} from "@deepwrite/contracts";
import { safeStorage } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEEPWRITE_PUBLIC_DATA_API_BASE_URL } from "./deepwrite-public-data-config";
import { requestMarketplace } from "./marketplace-request";
import { electronRemoteFetch } from "./electron-remote-fetch";

import {
  MarketplaceBindEmailInputSchema,
  MarketplaceEmailCodeInputSchema,
  MarketplaceEmailCodeResultSchema,
  MarketplaceEmailLoginInputSchema,
  type MarketplaceBindEmailInput,
  type MarketplaceEmailCodeInput,
  type MarketplaceEmailCodeResult,
  type MarketplaceEmailLoginInput
} from "@deepwrite/contracts";
import type {
  MarketplaceClientOptions,
  MarketplaceFetcher,
  SecureStorageLike,
  StoredMarketplaceSession
} from "./marketplace-client-options";
import { normalizeBaseUrl } from "./marketplace-http";
import {
  asRecord,
  MarketplaceClientError,
  normalizeUser,
  requiredString
} from "./marketplace-response";

const MARKETPLACE_SESSION_FILE_VERSION = 1;
export class MarketplaceAccountClient {
  private readonly baseUrl: string;
  private readonly fetcher: MarketplaceFetcher;
  private readonly storage: SecureStorageLike;
  private readonly now: () => number;
  private readonly sessionPath: string;
  private readonly loadPromise: Promise<void>;
  private token: string | undefined;
  private expiresAt: string | undefined;
  private user: MarketplaceUser | undefined;
  private persistent = false;

  constructor(userDataPath: string, options: MarketplaceClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? DEEPWRITE_PUBLIC_DATA_API_BASE_URL
    );
    this.fetcher = options.fetcher ?? electronRemoteFetch;
    this.storage = options.secureStorage ?? safeStorage;
    this.now = options.now ?? Date.now;
    this.sessionPath = join(userDataPath, "config", "marketplace-session.json");
    this.loadPromise = this.loadSession();
  }

  get insecureTransport(): boolean {
    return new URL(this.baseUrl).protocol === "http:";
  }

  async session(): Promise<MarketplaceSession> {
    await this.loadPromise;
    if (!this.token || this.isExpired()) return this.clearSession();
    const requestedToken = this.token;
    try {
      const user = normalizeUser(
        await this.request("GET", "/market/v1/me", { authenticated: true })
      );
      if (this.token !== requestedToken) return this.sessionSnapshot();
      this.user = user;
      return this.sessionSnapshot();
    } catch (error: unknown) {
      if (
        error instanceof MarketplaceClientError &&
        error.code === "marketplace.unauthorized"
      ) {
        return this.sessionSnapshot();
      }
      throw error;
    }
  }

  async register(input: MarketplaceRegisterInput): Promise<MarketplaceSession> {
    const parsed = MarketplaceRegisterInputSchema.parse(input);
    const data = asRecord(
      await this.request("POST", "/market/v1/auth/register", {
        authenticated: false,
        body: {
          username: parsed.username,
          password: parsed.password,
          display_name: parsed.displayName ?? "",
          email: parsed.email,
          email_code: parsed.emailCode
        }
      }),
      "注册结果"
    );
    await this.acceptAuthentication(data);
    return this.sessionSnapshot();
  }

  async login(input: MarketplaceLoginInput): Promise<MarketplaceSession> {
    const parsed = MarketplaceLoginInputSchema.parse(input);
    const data = asRecord(
      await this.request("POST", "/market/v1/auth/login", {
        authenticated: false,
        body: parsed
      }),
      "登录结果"
    );
    await this.acceptAuthentication(data);
    return this.sessionSnapshot();
  }

  async loginWithEmailCode(
    input: MarketplaceEmailLoginInput
  ): Promise<MarketplaceSession> {
    const parsed = MarketplaceEmailLoginInputSchema.parse(input);
    const data = asRecord(
      await this.request("POST", "/market/v1/auth/login/code", {
        authenticated: false,
        body: { email: parsed.email, email_code: parsed.emailCode }
      }),
      "登录结果"
    );
    await this.acceptAuthentication(data);
    return this.sessionSnapshot();
  }

  async sendEmailCode(
    input: MarketplaceEmailCodeInput
  ): Promise<MarketplaceEmailCodeResult> {
    const parsed = MarketplaceEmailCodeInputSchema.parse(input);
    const raw = asRecord(
      await this.request(
        "POST",
        parsed.purpose === "register"
          ? "/market/v1/auth/register/email-code"
          : parsed.purpose === "login"
            ? "/market/v1/auth/login/email-code"
            : "/market/v1/me/email-code",
        {
          authenticated: parsed.purpose === "account",
          body: { email: parsed.email }
        }
      ),
      "验证码发送结果"
    );
    return MarketplaceEmailCodeResultSchema.parse({
      expiresIn: raw.expires_in,
      retryAfter: raw.retry_after
    });
  }
  async bindEmail(
    input: MarketplaceBindEmailInput
  ): Promise<MarketplaceSession> {
    const parsed = MarketplaceBindEmailInputSchema.parse(input);
    await this.loadPromise;
    const token = this.token;
    const user = normalizeUser(
      await this.request("PUT", "/market/v1/me/email", {
        authenticated: true,
        body: { email: parsed.email, email_code: parsed.emailCode }
      })
    );
    if (this.token !== token || user.id !== this.user?.id)
      throw new MarketplaceClientError(
        "marketplace.session_changed",
        "登录状态已变化，请重新操作。"
      );
    this.user = user;
    return this.sessionSnapshot();
  }

  async logout(): Promise<MarketplaceSession> {
    await this.loadPromise;
    if (this.token) {
      try {
        await this.request("DELETE", "/market/v1/auth/session", {
          authenticated: true
        });
      } catch (error: unknown) {
        if (
          !(error instanceof MarketplaceClientError) ||
          error.code !== "marketplace.unauthorized"
        ) {
          throw error;
        }
      }
    }
    return this.clearSession();
  }

  /**
   * Sends a marketplace request with this client's session. Other plazas on
   * the same server (the agent team plaza) reuse it so sign-in is shared.
   */
  async request(
    method: string,
    path: string,
    options: {
      authenticated: boolean | "optional";
      body?: unknown;
    }
  ): Promise<unknown> {
    await this.loadPromise;
    const headers = new Headers({ Accept: "application/json" });
    let requestedToken: string | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (options.authenticated !== false && this.token && !this.isExpired()) {
      requestedToken = this.token;
      headers.set("Authorization", `Bearer ${requestedToken}`);
    } else if (options.authenticated === true) {
      await this.clearSession();
      throw new MarketplaceClientError(
        "marketplace.unauthorized",
        "请先登录技能广场。",
        401
      );
    }
    return requestMarketplace(
      {
        baseUrl: this.baseUrl,
        fetcher: this.fetcher,
        onUnauthorized: async () => {
          if (this.token === requestedToken) await this.clearSession();
        }
      },
      method,
      path,
      options,
      headers,
      requestedToken
    );
  }

  private async acceptAuthentication(
    data: Record<string, unknown>
  ): Promise<void> {
    const token = requiredString(data, "token");
    const expiresAt = requiredString(data, "expires_at");
    const user = normalizeUser(data.user);
    if (
      !token.startsWith("dw_user_") ||
      !Number.isFinite(Date.parse(expiresAt))
    ) {
      throw new MarketplaceClientError(
        "marketplace.invalid_response",
        "技能广场登录响应无效。"
      );
    }
    this.token = token;
    this.expiresAt = expiresAt;
    this.user = user;
    await this.persistSession();
  }

  private sessionSnapshot(): MarketplaceSession {
    return MarketplaceSessionSchema.parse({
      authenticated: Boolean(this.token && this.user && !this.isExpired()),
      ...(this.token && this.user && !this.isExpired()
        ? { user: this.user, expiresAt: this.expiresAt }
        : {}),
      persistent: this.persistent,
      insecureTransport: this.insecureTransport
    });
  }

  private isExpired(): boolean {
    return (
      !this.expiresAt ||
      !Number.isFinite(Date.parse(this.expiresAt)) ||
      Date.parse(this.expiresAt) <= this.now()
    );
  }

  private async loadSession(): Promise<void> {
    if (!this.storage.isEncryptionAvailable()) return;
    try {
      const raw = asRecord(
        JSON.parse(await readFile(this.sessionPath, "utf8")) as unknown,
        "本地会话"
      );
      if (
        raw.version !== MARKETPLACE_SESSION_FILE_VERSION ||
        typeof raw.encryptedToken !== "string" ||
        typeof raw.expiresAt !== "string"
      ) {
        return;
      }
      const token = this.storage.decryptString(
        Buffer.from(raw.encryptedToken, "base64")
      );
      if (!token.startsWith("dw_user_")) return;
      this.token = token;
      this.expiresAt = raw.expiresAt;
      this.persistent = true;
      if (this.isExpired()) await this.clearSession();
    } catch {
      this.token = undefined;
      this.expiresAt = undefined;
      this.persistent = false;
    }
  }

  private async persistSession(): Promise<void> {
    this.persistent = false;
    if (
      !this.token ||
      !this.expiresAt ||
      !this.storage.isEncryptionAvailable()
    ) {
      return;
    }
    const stored: StoredMarketplaceSession = {
      version: MARKETPLACE_SESSION_FILE_VERSION,
      encryptedToken: this.storage.encryptString(this.token).toString("base64"),
      expiresAt: this.expiresAt
    };
    await mkdir(dirname(this.sessionPath), { recursive: true });
    const temporary = `${this.sessionPath}.tmp-${process.pid}-${this.now()}`;
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, this.sessionPath);
    this.persistent = true;
  }

  private async clearSession(): Promise<MarketplaceSession> {
    this.token = undefined;
    this.expiresAt = undefined;
    this.user = undefined;
    this.persistent = false;
    await unlink(this.sessionPath).catch(() => undefined);
    return this.sessionSnapshot();
  }
}
