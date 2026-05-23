/**
 * Converts an absolute Supabase Storage URL to a local proxy URL.
 * Works regardless of which Supabase backend is configured.
 *
 * Input:  https://supa.blv.bg/storage/v1/object/public/products/x/y.jpg
 * Output: /api/images/products/x/y.jpg
 */
export function getImageSrc(absoluteUrl: string | null | undefined): string {
  if (!absoluteUrl) return '/placeholder.png'

  // Extract the relative path after /storage/v1/object/public/
  const match = absoluteUrl.match(/\/storage\/v1\/object\/public\/(.+)$/)
  if (match) {
    return `/api/images/${match[1]}`
  }

  // If not a Supabase Storage URL, return as-is
  return absoluteUrl
}
