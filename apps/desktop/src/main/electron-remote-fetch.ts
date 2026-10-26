import { net } from "electron";
import { waitForNetworkProxyPreference } from "./network-proxy-preference";

export async function electronRemoteFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  await waitForNetworkProxyPreference();
  return net.fetch(input, init);
}
