import type { BookImageBookRef } from "@deepwrite/contracts";
import { BookImagePathSchema } from "@deepwrite/contracts/renderer";
import { computed, inject, provide, type InjectionKey, type Ref } from "vue";

export interface BookImageContext {
  book: BookImageBookRef;
}

const bookImageContextKey: InjectionKey<
  Readonly<Ref<BookImageContext | undefined>>
> = Symbol("book-image-context");

export function provideBookImageContext(
  source: () => BookImageContext | undefined
): void {
  provide(bookImageContextKey, computed(source));
}

export function useBookImageContext() {
  return inject(
    bookImageContextKey,
    computed(() => undefined)
  );
}

export function resolveBookImageUrl(
  context: BookImageContext,
  path: string
): string | undefined {
  if (!BookImagePathSchema.safeParse(path).success) return undefined;
  const { projectType, projectId } = context.book;
  return `deepwrite-book-image://asset/${projectType}/${encodeURIComponent(projectId)}/${encodeURIComponent(path.slice("images/".length))}`;
}

export function useBookImageResolver() {
  const context = useBookImageContext();
  return computed(() => {
    const current = context.value;
    return current
      ? (path: string) => resolveBookImageUrl(current, path)
      : undefined;
  });
}
