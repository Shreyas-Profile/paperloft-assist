// Unit tests for the web-watcher pure helpers.
//
// Covered:
//   - hashHtml   — stable across whitespace/script/style noise, flips on
//                  real body change
//   - extractSignals — pulls h1/h2/h3 text + <a href=…> targets, drops
//                  obvious junk (mailto:, tel:, query-strings)
//   - fmtChange  — the Telegram message layout (new headings, new links,
//                  truncation at 6, host label)
//   - normalizeUrl — bare-domain → https://

import { describe, it, expect } from "vitest";
import {
  hashHtml,
  extractSignals,
  fmtChange,
  normalizeUrl,
  type PollResult,
} from "./hosted-web-watcher";

describe("hashHtml", () => {
  it("ignores whitespace changes", () => {
    const a = "<html><body><p>hello world</p></body></html>";
    const b = "<html>\n  <body>\n    <p>hello world</p>\n  </body>\n</html>";
    expect(hashHtml(a)).toBe(hashHtml(b));
  });

  it("ignores <script> and <style> blocks", () => {
    const a = "<html><head></head><body><p>hello</p></body></html>";
    const b = "<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><p>hello</p></body></html>";
    expect(hashHtml(a)).toBe(hashHtml(b));
  });

  it("ignores nonce attributes (change every render on strict-CSP sites)", () => {
    const a = '<html><body><div nonce="abc123">x</div></body></html>';
    const b = '<html><body><div nonce="xyz789">x</div></body></html>';
    expect(hashHtml(a)).toBe(hashHtml(b));
  });

  it("flips when real body text changes", () => {
    const a = "<html><body><p>hello</p></body></html>";
    const b = "<html><body><p>goodbye</p></body></html>";
    expect(hashHtml(a)).not.toBe(hashHtml(b));
  });
});

describe("extractSignals", () => {
  it("pulls h1/h2/h3 text and dedupes", () => {
    const html = `
      <h1>Main title</h1>
      <h2>Section one</h2>
      <h2>Section one</h2>
      <h3>Sub section</h3>
    `;
    const { headings } = extractSignals(html);
    expect(headings).toEqual(["Main title", "Section one", "Sub section"]);
  });

  it("strips inline tags from heading text", () => {
    const html = "<h1>Hello <span>world</span>!</h1>";
    const { headings } = extractSignals(html);
    expect(headings).toEqual(["Hello world!"]);
  });

  it("pulls <a href=...> targets, dedupes, strips query/anchor", () => {
    const html = `
      <a href="/about?utm=x">About</a>
      <a href="/about#top">About top</a>
      <a href="/contact">Contact</a>
      <a href="mailto:x@y.com">mail</a>
      <a href="tel:+111">phone</a>
    `;
    const { links } = extractSignals(html);
    expect(links).toContain("/about");
    expect(links).toContain("/contact");
    expect(links).not.toContain("mailto:x@y.com");
    expect(links).not.toContain("tel:+111");
  });

  it("caps at 60 headings / 80 links so a malicious or runaway page doesn't blow up storage", () => {
    const bigHeadings = Array.from({ length: 100 }, (_, i) => `<h1>H${i}</h1>`).join("");
    const bigLinks = Array.from({ length: 120 }, (_, i) => `<a href="/l${i}">x</a>`).join("");
    const { headings, links } = extractSignals(bigHeadings + bigLinks);
    expect(headings.length).toBeLessThanOrEqual(60);
    expect(links.length).toBeLessThanOrEqual(80);
  });
});

describe("fmtChange", () => {
  const watcher = { url: "https://example.com/jobs", label: null };

  it("includes host + sections of changes", () => {
    const result: PollResult = {
      id: "w1",
      url: "https://example.com/jobs",
      status: "changed",
      newHeadings: ["Senior Engineer", "Product Designer"],
      newLinks: ["/job/senior-engineer"],
    };
    const msg = fmtChange(watcher, result);
    expect(msg).toContain("example.com");
    expect(msg).toContain("New sections:");
    expect(msg).toContain("Senior Engineer");
    expect(msg).toContain("New links/pages:");
    expect(msg).toContain("/job/senior-engineer");
    expect(msg).toContain("https://example.com/jobs");
  });

  it("uses the label when provided", () => {
    const result: PollResult = {
      id: "w1",
      url: "https://example.com/jobs",
      status: "changed",
      newHeadings: ["New role"],
    };
    const msg = fmtChange({ url: "https://example.com/jobs", label: "ACME careers" }, result);
    expect(msg).toContain("ACME careers");
  });

  it("truncates lists past 6 entries with a '… +N more' line", () => {
    const many = Array.from({ length: 10 }, (_, i) => `Heading ${i}`);
    const result: PollResult = {
      id: "w1",
      url: "https://example.com/jobs",
      status: "changed",
      newHeadings: many,
    };
    const msg = fmtChange(watcher, result);
    expect(msg).toContain("+4 more");
  });
});

describe("normalizeUrl", () => {
  it("passes through http:// and https:// URLs", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("prefixes https:// on bare hosts", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("sub.example.co.uk/path")).toBe("https://sub.example.co.uk/path");
  });
  it("trims whitespace", () => {
    expect(normalizeUrl("  example.com  ")).toBe("https://example.com");
  });
});
