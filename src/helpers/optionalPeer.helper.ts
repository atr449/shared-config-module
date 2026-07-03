/**
 * Lazily require an optional peer dependency, surfacing a MODULE_NOT_FOUND as
 * an actionable "run this npm install" error instead of a raw stack trace —
 * used by every client that loads its SDK on first use rather than at import
 * time (see src/clients/*.ts).
 */
export function requireOptionalPeer<T>(
  moduleName: string,
  forFeature: string,
): T {
  try {
    return require(moduleName);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND'
    ) {
      throw new Error(
        `${forFeature} requires the optional peer dependency "${moduleName}", which is not installed. Run: npm install ${moduleName}`,
      );
    }
    throw error;
  }
}
