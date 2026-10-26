// Display languages are language codes; yt-dlp track keys may additionally
// contain opaque, case-sensitive IDs (for example en-ehkg1hFWq8A).
export function isCaptionLanguage(value) {
  return typeof value === 'string' && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value);
}
export function isCaptionTrackKey(value) {
  // Safe as a filename component and a literal in the anchored --sub-langs
  // pattern. No dots, slashes, escapes, whitespace or regex metacharacters.
  return typeof value === 'string' && value.length <= 128 && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9_-]+)?$/.test(value);
}
