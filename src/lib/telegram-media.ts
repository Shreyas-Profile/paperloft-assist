// Turn Telegram media (voice / photo / PDF) into plain text the chat handler
// can consume as if the user had typed it. The webhook route calls one of
// these three helpers depending on which field is present on the incoming
// message, then passes the returned string to handleTelegramMessage.
//
// Why do the multimodal call up here instead of feeding the raw file to the
// chat LLM? Two reasons:
//   1. The chat LLM (CHAT_MODEL, e.g. Anthropic Haiku via OpenRouter) can't
//      accept audio input — Anthropic Claude has no audio channel. We use
//      Gemini via OpenRouter for the voice → text step specifically.
//   2. Keeping the transcript/description as plain text means the whole
//      conversation stays in text form for history, retry logic, and the
//      hallucination-detection regex in telegram-chat.ts. Simpler is safer.

import { generateText } from "ai";

import { env } from "./env";
import { openrouter, CHAT_MODEL } from "./openrouter";

const API = "https://api.telegram.org";

// Voice notes need an audio-capable model. Anthropic Claude doesn't accept
// audio; Gemini does. Hardcoded so voice keeps working even if a customer
// swaps CHAT_MODEL to something text-only.
const AUDIO_MODEL = "google/gemini-2.5-flash";

// Telegram's own hard cap for file downloads via the Bot API.
const MAX_BYTES = 20 * 1024 * 1024;

export interface TelegramFileRef {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

interface TgFileMeta {
  file_path: string;
  file_size?: number;
}

async function getFileMeta(fileId: string): Promise<TgFileMeta | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const res = await fetch(
    `${API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const j = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: TgFileMeta }
    | null;
  if (!j?.ok || !j.result?.file_path) return null;
  return j.result;
}

async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`${API}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new Error(`Telegram file download failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`file too large: ${bytes.byteLength} bytes (max ${MAX_BYTES})`);
  }
  return Buffer.from(bytes);
}

async function downloadRef(
  ref: TelegramFileRef,
): Promise<{ bytes: Buffer; mimeType: string; fileName?: string }> {
  const meta = await getFileMeta(ref.file_id);
  if (!meta) throw new Error("Telegram getFile returned no path");
  const bytes = await downloadTelegramFile(meta.file_path);
  const mimeType = ref.mime_type ?? guessMime(meta.file_path);
  return { bytes, mimeType, fileName: ref.file_name };
}

function guessMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "oga" || ext === "ogg") return "audio/ogg";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

// ---- Voice transcription (OpenRouter → Gemini, direct fetch) --------------
//
// The ai-sdk OpenAI provider's `type: "file"` mapping for audio goes through
// OpenAI's `input_audio` shape, which OpenRouter forwards to Gemini. Rather
// than depend on that translation being intact, we hit OpenRouter's raw
// chat/completions endpoint with the well-known OpenAI-compatible shape.

export async function transcribeVoice(ref: TelegramFileRef): Promise<string> {
  const { bytes, mimeType } = await downloadRef(ref);
  const audioFormat = mimeTypeToAudioFormat(mimeType);
  const base64 = bytes.toString("base64");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/Shreyas-Profile/paperloft-assist",
      "X-Title": "Paperloft Assist",
    },
    body: JSON.stringify({
      model: AUDIO_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Transcribe this audio to plain text. Return ONLY the transcript, no commentary, no timestamps, no speaker labels. If the audio is silent or unintelligible, reply with the single word: (unintelligible).",
            },
            {
              type: "input_audio",
              input_audio: { data: base64, format: audioFormat },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`transcribeVoice HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("transcribeVoice returned empty text");
  return text;
}

function mimeTypeToAudioFormat(mimeType: string): string {
  // OpenAI-compatible audio format tokens.
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "mp4";
  return "ogg"; // Telegram voice notes are always OGG Opus.
}

// ---- Image description (chat model, vision) -------------------------------

export async function describeImage(
  ref: TelegramFileRef,
  caption?: string,
): Promise<string> {
  const { bytes, mimeType } = await downloadRef(ref);
  const captionLine = caption?.trim()
    ? `\n\nThe user's caption on this image: "${caption.trim()}"`
    : "";
  const { text } = await generateText({
    model: openrouter.chat(CHAT_MODEL),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You're helping a personal-assistant bot process an image the user just sent on Telegram. " +
              "Describe what's in the image in one short paragraph. Then, if there's any visible text, transcribe it verbatim under a 'Text in image:' heading. " +
              "If it looks like a prescription, receipt, screenshot, invoice, or form, treat it as one and pull out the useful structured details (dates, amounts, names, medications, etc.). " +
              "Keep the whole reply under 250 words. Plain text, no markdown headings." +
              captionLine,
          },
          { type: "file", data: bytes, mediaType: mimeType },
        ],
      },
    ],
  });
  return text.trim();
}

// ---- PDF summary (chat model, native document support) --------------------

export async function summarisePdf(
  ref: TelegramFileRef,
  caption?: string,
): Promise<string> {
  const { bytes, mimeType, fileName } = await downloadRef(ref);
  const captionLine = caption?.trim()
    ? `\n\nThe user's caption on this document: "${caption.trim()}"`
    : "";
  const { text } = await generateText({
    model: openrouter.chat(CHAT_MODEL),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Summarise this PDF (${fileName ?? "document.pdf"}) for a personal-assistant chat. ` +
              "Cover the key facts: what it is, dates, names, amounts, deadlines, action items. " +
              "If it's an invoice, ticket, prescription, form, or bill, pull out the specific details. " +
              "Keep it under 300 words. Plain text, no markdown headings." +
              captionLine,
          },
          { type: "file", data: bytes, mediaType: mimeType },
        ],
      },
    ],
  });
  return text.trim();
}

// ---- MIME type classification --------------------------------------------

const WORD_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isWordDoc(mimeType?: string, fileName?: string): boolean {
  if (mimeType && WORD_MIMES.has(mimeType)) return true;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  return ext === "doc" || ext === "docx";
}

export function isPdf(mimeType?: string, fileName?: string): boolean {
  if (mimeType === "application/pdf") return true;
  return fileName?.toLowerCase().endsWith(".pdf") ?? false;
}

export function isImage(mimeType?: string, fileName?: string): boolean {
  if (mimeType?.startsWith("image/")) return true;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext ?? "");
}
