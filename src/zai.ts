import { ZAI_ENDPOINTS, type ZaiProtocol } from "./endpoints";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function requireKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error("ZAI_API_KEY is not set (use wrangler secret put ZAI_API_KEY)");
  }
  return apiKey;
}

/** OpenAI Chat Completions → https://api.z.ai/api/coding/paas/v4 */
export async function chatCompletions(
  apiKey: string | undefined,
  body: {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
    temperature?: number;
  },
): Promise<Response> {
  const key = requireKey(apiKey);
  return fetch(`${ZAI_ENDPOINTS.openaiChat}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** OpenAI Responses → https://api.z.ai/api/v1 */
export async function responsesCreate(
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<Response> {
  const key = requireKey(apiKey);
  return fetch(`${ZAI_ENDPOINTS.openaiResponses}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Anthropic Messages → https://api.z.ai/api/anthropic */
export async function anthropicMessages(
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<Response> {
  const key = requireKey(apiKey);
  return fetch(`${ZAI_ENDPOINTS.anthropic}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
}

/** Proxy an inbound request to the matching Z.AI base URL, injecting the key. */
export async function proxyToZai(
  protocol: ZaiProtocol,
  apiKey: string | undefined,
  request: Request,
  suffixPath: string,
): Promise<Response> {
  const key = requireKey(apiKey);
  const base = ZAI_ENDPOINTS[protocol];
  const url = new URL(request.url);
  const target = new URL(
    `${base}${suffixPath}${url.search}`,
  );

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");
  headers.delete("x-forwarded-proto");
  headers.delete("x-real-ip");

  if (protocol === "anthropic") {
    headers.set("x-api-key", key);
    headers.set("Authorization", `Bearer ${key}`);
    if (!headers.has("anthropic-version")) {
      headers.set("anthropic-version", "2023-06-01");
    }
  } else {
    headers.set("Authorization", `Bearer ${key}`);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "follow",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  return fetch(target, init);
}

export async function extractAssistantText(res: Response): Promise<string> {
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ type?: string; text?: string }>;
    output_text?: string;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `Z.AI error ${res.status}`,
    );
  }

  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  if (typeof data.output_text === "string") {
    return data.output_text;
  }
  if (Array.isArray(data.content)) {
    return data.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }
  return JSON.stringify(data);
}

/** Map hour-slot prompts → parallel Z.AI calls, then reduce into one summary. */
export async function mapReduceWake(
  apiKey: string | undefined,
  model: string,
  prompts: string[],
): Promise<{ parts: string[]; summary: string }> {
  const parts = await Promise.all(
    prompts.map(async (prompt, i) => {
      const res = await chatCompletions(apiKey, {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are AI Wake for Asia/Dhaka. Be concise and actionable.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
      });
      const text = await extractAssistantText(res);
      return `[${i + 1}/${prompts.length}] ${text}`;
    }),
  );

  if (parts.length === 1) {
    return { parts, summary: parts[0]! };
  }

  const reduceRes = await chatCompletions(apiKey, {
    model,
    messages: [
      {
        role: "system",
        content:
          "Reduce the following hour-slot notes into one short Dhaka-time briefing.",
      },
      { role: "user", content: parts.join("\n\n---\n\n") },
    ],
    temperature: 0.2,
  });

  const summary = await extractAssistantText(reduceRes);
  return { parts, summary };
}
