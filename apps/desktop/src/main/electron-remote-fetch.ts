import { net } from "electron";

export function electronRemoteFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  return net.fetch(input, init);
}
