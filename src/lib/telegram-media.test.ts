// Unit tests for pure helpers in telegram-media.ts.
// Each test corresponds to a real production case — MIME classification
// drives the entire download-and-route pipeline, so getting it wrong
// silently drops user attachments.

import { describe, it, expect } from "vitest";

import {
  guessMime,
  mimeTypeToAudioFormat,
  isPdf,
  isImage,
  isWordDoc,
} from "./telegram-media";

describe("guessMime — extension to MIME mapping", () => {
  it("maps ogg + oga to audio/ogg (Telegram voice notes)", () => {
    expect(guessMime("voice/foo.ogg")).toBe("audio/ogg");
    expect(guessMime("voice/foo.oga")).toBe("audio/ogg");
  });

  it("maps common audio formats", () => {
    expect(guessMime("song.mp3")).toBe("audio/mpeg");
    expect(guessMime("song.wav")).toBe("audio/wav");
    expect(guessMime("song.m4a")).toBe("audio/mp4");
  });

  it("maps common image formats", () => {
    expect(guessMime("pic.jpg")).toBe("image/jpeg");
    expect(guessMime("pic.jpeg")).toBe("image/jpeg");
    expect(guessMime("pic.png")).toBe("image/png");
    expect(guessMime("pic.webp")).toBe("image/webp");
    expect(guessMime("pic.gif")).toBe("image/gif");
  });

  it("maps pdf and falls back to octet-stream on unknown", () => {
    expect(guessMime("doc.pdf")).toBe("application/pdf");
    expect(guessMime("mystery.xyz")).toBe("application/octet-stream");
    expect(guessMime("noext")).toBe("application/octet-stream");
  });

  it("is case-insensitive for extensions", () => {
    expect(guessMime("PIC.JPG")).toBe("image/jpeg");
    expect(guessMime("Doc.PDF")).toBe("application/pdf");
  });
});

describe("mimeTypeToAudioFormat — OpenAI-compatible token", () => {
  it("returns the format token OpenAI + OpenRouter expect", () => {
    expect(mimeTypeToAudioFormat("audio/ogg")).toBe("ogg");
    expect(mimeTypeToAudioFormat("audio/mpeg")).toBe("mp3");
    expect(mimeTypeToAudioFormat("audio/mp3")).toBe("mp3");
    expect(mimeTypeToAudioFormat("audio/wav")).toBe("wav");
    expect(mimeTypeToAudioFormat("audio/mp4")).toBe("mp4");
    expect(mimeTypeToAudioFormat("audio/m4a")).toBe("mp4");
  });

  it("falls back to ogg (Telegram voice-note default) on unknown", () => {
    // If Telegram ever changes voice-note format we want the fallback to
    // keep working — the transcribeVoice call will still succeed as long
    // as the format token is one Gemini accepts.
    expect(mimeTypeToAudioFormat("application/octet-stream")).toBe("ogg");
    expect(mimeTypeToAudioFormat("")).toBe("ogg");
  });
});

describe("isPdf / isImage / isWordDoc — document dispatch", () => {
  it("isPdf matches by mime or by filename", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf(undefined, "receipt.pdf")).toBe(true);
    expect(isPdf(undefined, "receipt.PDF")).toBe(true);
    expect(isPdf("image/jpeg")).toBe(false);
    expect(isPdf(undefined, "receipt.jpg")).toBe(false);
    expect(isPdf(undefined, undefined)).toBe(false);
  });

  it("isImage matches image/* mime or common extensions", () => {
    expect(isImage("image/jpeg")).toBe(true);
    expect(isImage("image/png")).toBe(true);
    expect(isImage(undefined, "photo.webp")).toBe(true);
    expect(isImage(undefined, "photo.gif")).toBe(true);
    expect(isImage("application/pdf")).toBe(false);
  });

  it("isWordDoc matches both .doc and .docx (mime OR filename)", () => {
    // Word support isn't wired yet — this dispatcher must fire the
    // "save as PDF" friendly reply, so recognising both extensions matters.
    expect(
      isWordDoc(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(isWordDoc("application/msword")).toBe(true);
    expect(isWordDoc(undefined, "meeting-notes.docx")).toBe(true);
    expect(isWordDoc(undefined, "meeting-notes.doc")).toBe(true);
    expect(isWordDoc(undefined, "meeting-notes.pdf")).toBe(false);
  });
});
