import type { ToolRegistry } from "./registry.js";

export function registerWebTools(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: "web_fetch",
      description:
        "Fetch a URL and return its content. For HTML pages, returns simplified text content. " +
        "For JSON APIs, returns the JSON. Useful for reading docs, APIs, and web pages.",
      parameters: {
        properties: {
          url: { type: "string", description: "URL to fetch" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], description: "HTTP method (default: GET)" },
          headers: { type: "object", description: "Request headers as key-value pairs" },
          body: { type: "string", description: "Request body (for POST/PUT/PATCH)" },
        },
        required: ["url"],
      },
    },
    execute: async (args) => {
      const url = args.url as string;
      const method = (args.method as string) ?? "GET";
      const headers = (args.headers as Record<string, string>) ?? {};
      const body = args.body as string | undefined;

      try {
        const resp = await fetch(url, {
          method,
          headers: {
            "User-Agent": "Hive-Agent/0.1",
            ...headers,
          },
          ...(body && { body }),
        });

        const contentType = resp.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const json = await resp.json();
          return JSON.stringify(json, null, 2).slice(0, 20_000);
        }

        const text = await resp.text();

        // If HTML, extract text content
        if (contentType.includes("text/html")) {
          return htmlToText(text).slice(0, 20_000);
        }

        return text.slice(0, 20_000);
      } catch (err: any) {
        return `Fetch error: ${err.message}`;
      }
    },
  });

  registry.register({
    definition: {
      name: "web_search",
      description:
        "Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets.",
      parameters: {
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
    execute: async (args) => {
      const query = encodeURIComponent(args.query as string);
      try {
        const resp = await fetch(
          `https://html.duckduckgo.com/html/?q=${query}`,
          {
            headers: { "User-Agent": "Hive-Agent/0.1" },
          }
        );
        const html = await resp.text();
        // Extract result links and snippets from DDG HTML
        const results: string[] = [];
        const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
        const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi;

        let match;
        const links: { url: string; title: string }[] = [];
        while ((match = linkRegex.exec(html)) !== null) {
          links.push({
            url: decodeURIComponent(match[1].replace(/.*uddg=/, "").replace(/&.*/, "")),
            title: match[2].replace(/<[^>]*>/g, ""),
          });
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
          snippets.push(match[1].replace(/<[^>]*>/g, ""));
        }

        for (let i = 0; i < Math.min(links.length, 10); i++) {
          results.push(`${i + 1}. ${links[i].title}\n   ${links[i].url}\n   ${snippets[i] ?? ""}\n`);
        }

        return results.join("\n") || "No results found";
      } catch (err: any) {
        return `Search error: ${err.message}`;
      }
    },
  });
}

function htmlToText(html: string): string {
  // Simple HTML to text conversion
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
