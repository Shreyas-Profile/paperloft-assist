"use client";

// Client-side messenger from Alpha Assist to the chrome-agent Chrome extension.
//
// The extension declares `externally_connectable` for our origin, and adds
// a `chrome.runtime.onMessageExternal` listener that speaks the same
// {cmd, args} protocol the WebSocket path uses. So all we do here is
// forward the LLM's tool-call verbatim.
//
// The extension ID is a plain string like "abcdefghijklmnopabcdefghijklmnop" —
// copy it from chrome://extensions/ after loading the extension, paste into
// .env.local as NEXT_PUBLIC_ALPHA_ASSIST_EXTENSION_ID. Next.js inlines
// NEXT_PUBLIC_* env vars into the client bundle at build time.

type ChromeMinimal = {
  runtime?: {
    sendMessage?: (
      id: string,
      msg: unknown,
      cb: (reply: unknown) => void,
    ) => void;
    lastError?: { message: string };
  };
};

export type ExtensionReply = { ok: true; result: unknown } | { ok: false; error: string };

function rawCall(cmd: string, args: unknown): Promise<unknown> {
  const id = process.env.NEXT_PUBLIC_ALPHA_ASSIST_EXTENSION_ID;
  if (!id) {
    throw new Error(
      "Chrome extension isn't configured. Set NEXT_PUBLIC_ALPHA_ASSIST_EXTENSION_ID in .env.local (get the ID from chrome://extensions/).",
    );
  }
  const chromeApi = (globalThis as unknown as { chrome?: ChromeMinimal }).chrome;
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error(
      "This action needs the alpha-assist Chrome extension installed and enabled. Open http://localhost:3000 in Chrome (not the sandboxed one Claude Code launches), install chrome-agent, then reload this page.",
    );
  }

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        chromeApi.runtime!.sendMessage!(id, { cmd, args }, (reply) => {
          const err = chromeApi.runtime?.lastError;
          if (err) return reject(new Error(err.message));
          const r = reply as ExtensionReply | undefined;
          if (!r) return reject(new Error("Extension did not reply (may be uninstalled or reloading)."));
          if (!r.ok) return reject(new Error(r.error || "extension returned an error"));
          resolve(r.result);
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, 0);
  });
}

// Dedup guard for browser_new_tab. Even with parallelToolCalls: false, a
// confused LLM might still ask us to open the same URL twice. If we already
// have a tab on that URL (or a same-origin URL for the same site), return
// its id instead of spawning a duplicate.
async function newTabDedup(args: { url?: string }): Promise<unknown> {
  const wantUrl = args?.url;
  if (!wantUrl) return rawCall("browser_new_tab", args);
  try {
    const tabs = (await rawCall("browser_list_tabs", {})) as Array<{
      id: number;
      url: string;
      title?: string;
    }>;
    const wantOrigin = new URL(wantUrl).origin;
    const existing = tabs.find((t) => {
      try {
        return new URL(t.url).origin === wantOrigin;
      } catch {
        return false;
      }
    });
    if (existing) {
      await rawCall("browser_activate_tab", { tab_id: existing.id });
      return { tab_id: existing.id, url: existing.url, reused: true };
    }
  } catch {
    // Fall through to a plain new_tab if listing fails for any reason.
  }
  return rawCall("browser_new_tab", args);
}

export async function callExtension(
  cmd: string,
  args: unknown,
): Promise<unknown> {
  if (cmd === "browser_new_tab") {
    return newTabDedup(args as { url?: string });
  }
  return rawCall(cmd, args);
}
