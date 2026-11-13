// The build-time prerender (scripts/prerender.tsx) stamps the dataset's
// refresh time on #root, so pages opened directly can show it without
// downloading the whole index. Read once, before React replaces the markup.
let updatedAt: string | null | undefined;

export function prerenderedUpdatedAt(): string | null {
  if (updatedAt === undefined) {
    updatedAt =
      typeof document === 'undefined'
        ? null
        : (document.getElementById('root')?.getAttribute('data-updated-at') ?? null);
  }
  return updatedAt;
}
