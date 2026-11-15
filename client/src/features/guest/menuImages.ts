import cachedImages from './menu-image-cache.json';

const imageCache: Record<string, string> = cachedImages;
export function menuImageSource(source: string): string {
  if (source in imageCache) return imageCache[source]!;
  // Sizing parameters can change without changing the underlying photograph.
  try {
    const url = new URL(source);
    if (url.hostname === 'images.unsplash.com') {
      const cached = Object.keys(imageCache).find((key) => {
        const candidate = new URL(key);
        return candidate.hostname === url.hostname && candidate.pathname === url.pathname;
      });
      if (cached) return imageCache[cached]!;
    }
  } catch {
    /* Relative/local assets are already suitable image sources. */
  }
  return source;
}
