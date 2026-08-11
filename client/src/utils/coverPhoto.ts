export const PLACEHOLDER_COVER_URL = '/images/placeholder-cover.svg'

export type CoverPhotoKind = 'none' | 'placeholder' | 'gallery'

export function getCoverPhotoKind(
  coverPhotoUrl: string | null | undefined,
  coverPhotoAssetId: number | null | undefined,
): CoverPhotoKind {
  if (coverPhotoAssetId != null) return 'gallery'
  if (coverPhotoUrl === PLACEHOLDER_COVER_URL) return 'placeholder'
  if (coverPhotoUrl?.trim()) return 'gallery'
  return 'none'
}

export function getCoverPhotoUrl(
  coverPhotoUrl: string | null | undefined,
  coverPhotoAssetId: number | null | undefined,
): string | null {
  const kind = getCoverPhotoKind(coverPhotoUrl, coverPhotoAssetId)
  if (kind === 'none') return null
  if (kind === 'placeholder') return PLACEHOLDER_COVER_URL
  return coverPhotoUrl!.trim()
}
