import { describe, expect, it } from "vitest";
import {
  getVoiceTranscriptionTimeout,
  NATIVE_TRANSCRIPTION_TIMEOUT_MS,
  WHISPER_TIMEOUT_BASE_MS,
  WHISPER_TIMEOUT_MAX_MS,
  WHISPER_TIMEOUT_PER_SECOND_MS,
} from "./voiceTimeout";

describe("getVoiceTranscriptionTimeout", () => {
  it("uses the fast 9s timeout for the native engine (no duration passed)", () => {
    expect(getVoiceTranscriptionTimeout()).toBe(NATIVE_TRANSCRIPTION_TIMEOUT_MS);
    expect(getVoiceTranscriptionTimeout(undefined)).toBe(
      NATIVE_TRANSCRIPTION_TIMEOUT_MS,
    );
  });

  it("never drops below the 20s floor for whisper captures", () => {
    // An empty capture (0s) still needs the model load time.
    expect(getVoiceTranscriptionTimeout(0)).toBe(WHISPER_TIMEOUT_BASE_MS);
    expect(getVoiceTranscriptionTimeout(0.01)).toBe(WHISPER_TIMEOUT_BASE_MS + WHISPER_TIMEOUT_PER_SECOND_MS);
  });

  it("scales the wait with the recording duration", () => {
    // 1s -> ceil(1) * 2s + 20s = 22s
    expect(getVoiceTranscriptionTimeout(1)).toBe(22000);
    // 10.4s -> ceil(11) * 2s + 20s = 42s
    expect(getVoiceTranscriptionTimeout(10.4)).toBe(42000);
    // 139s -> ceil(139) * 2s + 20s = 298s (still under the cap)
    expect(getVoiceTranscriptionTimeout(139)).toBe(298000);
  });

  it("caps the wait at 5 minutes for long recordings", () => {
    // 140s -> 300s exactly, which is the cap.
    expect(getVoiceTranscriptionTimeout(140)).toBe(WHISPER_TIMEOUT_MAX_MS);
    // Anything longer stays pinned at the cap.
    expect(getVoiceTranscriptionTimeout(600)).toBe(WHISPER_TIMEOUT_MAX_MS);
    expect(getVoiceTranscriptionTimeout(3600)).toBe(WHISPER_TIMEOUT_MAX_MS);
  });
});
