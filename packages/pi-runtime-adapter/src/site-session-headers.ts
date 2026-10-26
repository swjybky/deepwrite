import { randomUUID } from "node:crypto";
import { isDeepWriteSiteOfficialModel } from "@deepwrite/contracts";

/** Only Main's official-site model identities participate in gateway routing. */
export function createSiteSessionHeaders(model: { id: string }) {
  const enabled = isDeepWriteSiteOfficialModel(model);
  let fallbackSessionId: string | undefined;
  return (sessionId?: string): Record<string, string> | undefined => {
    if (!enabled) return undefined;
    return {
      "X-DeepWrite-Session-ID":
        sessionId?.trim() || (fallbackSessionId ??= randomUUID())
    };
  };
}
