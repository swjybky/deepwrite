import {
  ExternalWindowRequestSchema,
  type ExternalWindowRequest,
  type ExternalWindowResponse
} from "@deepwrite/contracts/external-control";
import { randomUUID } from "node:crypto";
import { ExternalControlError } from "./errors";

/** Below the bridge's own call timeout, so the agent gets this error instead. */
const WINDOW_REQUEST_TIMEOUT_MS = 40_000;

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: ExternalControlError): void;
}

interface WindowRequestOptions {
  send(id: string, request: ExternalWindowRequest): void;
  timeoutMs?: number;
}

/** Conversations live in the Renderer, so Main has to ask and wait. */
export function createWindowRequests(options: WindowRequestOptions) {
  const timeoutMs = options.timeoutMs ?? WINDOW_REQUEST_TIMEOUT_MS;
  const pending = new Map<string, PendingRequest>();

  return {
    request(rawRequest: ExternalWindowRequest): Promise<unknown> {
      const request = ExternalWindowRequestSchema.parse(rawRequest);
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new ExternalControlError(
              "external.not_ready",
              "DeepWrite 窗口没有响应。请确认软件已打开后重试。"
            )
          );
        }, timeoutMs);
        pending.set(id, {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        });
        options.send(id, request);
      });
    },
    /** An unknown id is a reply that already timed out, so it is dropped. */
    resolve(response: ExternalWindowResponse): void {
      const call = pending.get(response.requestId);
      pending.delete(response.requestId);
      if (!call) return;
      if (response.ok) call.resolve(response.result);
      else {
        call.reject(new ExternalControlError(response.code, response.message));
      }
    }
  };
}

export type WindowRequests = ReturnType<typeof createWindowRequests>;
