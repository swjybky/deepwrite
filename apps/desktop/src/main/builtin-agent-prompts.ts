import { createHash } from "node:crypto";
import {
  BUILTIN_AGENT_SYSTEM_PROMPTS,
  PROMPT_LOCALES,
  type BuiltinAgentPromptKey,
  type PromptLocale
} from "@deepwrite/contracts";
import { nativeLocale } from "./native-i18n";

/**
 * SHA-256 of earlier built-in prompts (trimmed, LF line endings). A saved
 * prompt that still equals one of them was never customized, so it is served
 * as the current built-in prompt of the app language.
 */
const LEGACY_PROMPT_FINGERPRINTS: Readonly<
  Record<BuiltinAgentPromptKey, readonly string[]>
> = {
  short: [
    "13481f2749eba2a49177ff3f392e4d60b38c968b0126f22dc19b0135f9c3011b",
    "e317372682022a5f4a0e0bcb85cac0cbc7812a2c6700635e837bee9ab4422251",
    "76346e91e4a0fa915e5758d0bec102bda8b698a1eaae4131095f394dc4b8225f",
    "d06ad79db94adf43359724cb30a7ca04c6badd48e0c5bf2a375ab5c506dfe799",
    "1a90447f0eb819f4e02d32c8758f8ec1b1e9c1fe62928fc1eb504f4171f194c4"
  ],
  script: [
    "ebf564725eb876efa8df3e8fb1ff4bbf8b9bade0efd557793b07946fc9fb48cc",
    "de35051ccdbe6233473712b0ecc7ece1202fb6654f7e184709bf0ebe13a2e78d",
    "8e02d1f1c753c22332982728848d44fd5b16312d06a09c8c4334e9290d2edf30",
    "0049e106545239ca52d842481839b43978b80e542d43e6506ac3aa663ffdbbcf",
    "81f915297ee76b3a04a95a74d63948d36c8af34b4efe88aadfa26f7a570ea441"
  ],
  long: [
    "a8d33bf3e356eadf7630570f1a178f5e880635be825ca417d5e3c1937d8fc118",
    "4e2a9bd7f06a45f7b7cc837dcd9a4cce97d9e96a89a9f29bbe226b9db1aad4a1",
    "b1403dad09b4dafbd6bfbc68674af0979e2e46529bfdce891c14241a76822f15",
    "b6d23ebea26c14b46e97f6904870d34999d2d59b7649dcf8238b2e0541d8b2a5",
    "5ad6cbfd869ab435833ae2525056d78c6ebc09bff7366676df2712753b1f9641",
    "62e0634292335bbf23b1a8df165b0ebe067480ddab7293dfe7cddf237444e830",
    "e6578392b82557e7a6c792704318ccc1f1be6f276a6094351b253c00d5df9445",
    "2bce5325e2be36175f03c48f296b16fc81d5967735bf6b78e23af879bc3ffbf1",
    "b498b8338cce61c11dc5a85c20df5923ea65c5bf34a384bf1b091c0c4feacbf0"
  ],
  material: [
    "927455f3b9ae499d725cb61b50b454801b6899df7b49371f4c49be0a10e7a7d2",
    "1167d9285b09a60639c1b51fe0ef3f5cf76a6c6a6671767c49ce3e15d07091b0",
    "7bcf29619a7dd425bf7edb6ca97c5dc604e202e5db033db31c08fd90049d0ee9"
  ],
  skill: [
    "8d72db2925c8f9db76c29f34fae1fbaa1e1a56919814326cf1977eaec4401c65",
    "bef3e68810b916c8f7efeaaca28e838dcc74c9e4dcb400cf67507d364f673a8f",
    "0b98a7fd0061fbef2533293cfb84d4a48ab8babb0ac89a2aaab7a7ac8cf544d0"
  ]
};

export function promptFingerprint(text: string): string {
  return createHash("sha256")
    .update(text.replace(/\r\n/g, "\n").trim())
    .digest("hex");
}

const knownFingerprints = new Map<BuiltinAgentPromptKey, ReadonlySet<string>>();

function builtinFingerprints(key: BuiltinAgentPromptKey): ReadonlySet<string> {
  let known = knownFingerprints.get(key);
  if (!known) {
    known = new Set([
      ...LEGACY_PROMPT_FINGERPRINTS[key],
      ...PROMPT_LOCALES.map((locale) =>
        promptFingerprint(BUILTIN_AGENT_SYSTEM_PROMPTS[key][locale])
      )
    ]);
    knownFingerprints.set(key, known);
  }
  return known;
}

/** True when a saved prompt is any language or past version of the built-in one. */
export function isBuiltinAgentSystemPrompt(
  key: BuiltinAgentPromptKey,
  text: string
): boolean {
  return builtinFingerprints(key).has(promptFingerprint(text));
}

/** The built-in prompt for the app's current language (or the given one). */
export function builtinAgentPromptFor(
  key: BuiltinAgentPromptKey,
  locale: PromptLocale = nativeLocale()
): string {
  return BUILTIN_AGENT_SYSTEM_PROMPTS[key][locale];
}

/**
 * Customized prompts are kept as written; built-in ones follow the language
 * setting ("auto" follows the system), so switching it takes effect at once.
 */
export function localizeAgentSystemPrompt(
  key: BuiltinAgentPromptKey,
  text: string | undefined,
  locale: PromptLocale = nativeLocale()
): string {
  return text === undefined || isBuiltinAgentSystemPrompt(key, text)
    ? builtinAgentPromptFor(key, locale)
    : text;
}
