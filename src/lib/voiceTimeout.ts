// Wait (ms) granted to the native Windows recognizer (SAPI): it answers within
// a couple of seconds, so a short fixed timeout is enough.
export const NATIVE_TRANSCRIPTION_TIMEOUT_MS = 9000;

// Whisper is a local CPU transcription whose runtime scales with the length of
// the recording (the ~75MB model alone takes 2–5s to load). Per-second budget
// added on top of a base floor.
export const WHISPER_TIMEOUT_PER_SECOND_MS = 2000;
export const WHISPER_TIMEOUT_BASE_MS = 20000;
export const WHISPER_TIMEOUT_MAX_MS = 300000; // 5 minutes

/**
 * Computes how long the UI should wait for a voice transcription before
 * giving up with a "Transcription timed out" error.
 *
 * - Native engine callers pass nothing (undefined) -> fast 9s timeout.
 * - Whisper callers always pass the recorded duration — even 0 for an empty
 *   capture — so the wait scales with the audio length: duration × 2s + 20s,
 *   capped at 5 minutes so a very long recording can never hang the UI.
 */
export function getVoiceTranscriptionTimeout(durationSecs?: number): number {
  if (typeof durationSecs !== "number") {
    return NATIVE_TRANSCRIPTION_TIMEOUT_MS;
  }
  return Math.min(
    Math.ceil(durationSecs) * WHISPER_TIMEOUT_PER_SECOND_MS +
      WHISPER_TIMEOUT_BASE_MS,
    WHISPER_TIMEOUT_MAX_MS,
  );
}
