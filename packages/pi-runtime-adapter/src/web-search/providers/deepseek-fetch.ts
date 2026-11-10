import { WEB_SEARCH_PROVIDERS } from "@deepwrite/contracts";
import { WebSearchProviderError, type WebFetchCapability } from "../types";
import { failureFor, isRecord, requestJson } from "./http";

/** https://api-docs.deepseek.com/zh-cn/api/fetch */
const FETCH_PATH = "/v1/tools/fetch";
/** The service documents no size; Markdown beyond this is not a page worth reading. */
const RESPONSE_LIMIT_BYTES = 8 * 1024 * 1024;

/** Fetch adds two refusals search never gets: 403 for policy, 404 for no usable text. */
function fetchFailure(response: Response): WebSearchProviderError | undefined {
  if (response.status === 403)
    return new WebSearchProviderError("blocked", false);
  if (response.status === 404)
    return new WebSearchProviderError("no_content", false);
  return failureFor(response);
}

export const deepSeekWebFetch: WebFetchCapability = {
  // Account-level and apart from search's own 5 QPS; the service also limits
  // each target domain and answers 429 for that too.
  maxQps: 5,
  async page(request, context) {
    if (request.url.length > WEB_SEARCH_PROVIDERS.deepseek.fetchUrlMaxChars)
      throw new WebSearchProviderError("bad_request", false);
    const body = await requestJson(FETCH_PATH, { url: request.url }, context, {
      limitBytes: RESPONSE_LIMIT_BYTES,
      statusFailure: fetchFailure
    });
    if (!isRecord(body) || typeof body.content !== "string")
      throw new WebSearchProviderError("invalid_response", false);
    const content = body.content.trim();
    // Only a page with text is billed, so an empty 200 is a failed read.
    if (!content) throw new WebSearchProviderError("no_content", false);
    return {
      title: typeof body.title === "string" ? body.title.trim() : "",
      url: request.url,
      content
    };
  }
};
