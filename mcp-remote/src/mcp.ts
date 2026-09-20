/**
 * MCP over Streamable HTTP, as a plain Worker.
 *
 * No Durable Object and no session state. The protocol only needs one when the server has
 * something to remember between calls, and these four tools are each a single HTTP request --
 * so every POST can be answered on its own and the whole thing runs on request-scoped
 * infrastructure.
 *
 * Only the three methods a client actually needs to use tools are implemented: `initialize`,
 * `tools/list` and `tools/call`. Anything else gets a proper JSON-RPC "method not found" rather
 * than a 500, because a client probing for an optional capability should be told no, not
 * handed a crash.
 */

import { TOOLS, type Env } from "./tools";

/**
 * Protocol versions this server knows how to speak.
 *
 * The client's requested version is echoed back when it is one of these, because that is what
 * the spec asks for; an unknown one gets our newest rather than an error, which is the
 * difference between a client that negotiates down and a client that cannot connect at all.
 */
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = SUPPORTED[0];

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

const result = (id: JsonRpcId, value: unknown) =>
  Response.json({ jsonrpc: "2.0", id, result: value });

const failure = (id: JsonRpcId, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

async function handleOne(message: JsonRpcRequest, env: Env): Promise<Response> {
  const id = message.id ?? null;

  switch (message.method) {
    case "initialize": {
      const asked = String(message.params?.protocolVersion ?? "");
      return result(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "prep-publisher", version: "0.1.0" },
        instructions:
          "Publishes study notes into a personal interview-prep board. Pick the tool matching " +
          "the discipline (each tool's own description says which); ask if unsure rather than " +
          "guessing. Call prep_search before publishing, to extend an existing page instead of " +
          "duplicating it.",
      });
    }

    case "tools/list":
      return result(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      });

    case "tools/call": {
      const name = String(message.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${name}`);

      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const output = await tool.run(env, args);
        // `isError` rather than a JSON-RPC error: a tool that ran and was refused (a duplicate
        // page, say) is a result the model should read and act on, not a transport failure.
        const failed = (output as { ok?: boolean }).ok === false;
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          isError: failed,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return result(id, {
          content: [{ type: "text", text: `Tool failed: ${reason}` }],
          isError: true,
        });
      }
    }

    // Notifications carry no id and expect no body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new Response(null, { status: 202 });

    case "ping":
      return result(id, {});

    default:
      return failure(id, -32601, `Method not found: ${message.method}`);
  }
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  // GET opens the server-to-client stream, which a server with nothing to push does not need.
  // 405 is the spec's way of saying exactly that.
  if (request.method === "GET") {
    return new Response("This server does not offer a server-initiated stream.", {
      status: 405,
      headers: { Allow: "POST, DELETE" },
    });
  }
  // No session state, so there is no session to end -- but saying so beats a 404.
  if (request.method === "DELETE") return new Response(null, { status: 204 });
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(null, -32700, "Parse error");
  }

  // A batch is legal in JSON-RPC and some clients send one on connect.
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map(async (m) => {
        const r = await handleOne(m as JsonRpcRequest, env);
        return r.status === 202 ? null : await r.json();
      }),
    );
    const answered = responses.filter((r) => r !== null);
    return answered.length ? Response.json(answered) : new Response(null, { status: 202 });
  }

  return handleOne(body as JsonRpcRequest, env);
}
