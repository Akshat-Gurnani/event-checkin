import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

// Called only by the database (trigger / test function) with a shared secret.
// Sends a Web Push message to every registered device of the relevant rep(s).
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = req.headers.get("x-push-secret") ?? "";
  if (!secret) return new Response("unauthorized", { status: 401 });

  let body: { kind?: string; id?: number; rep_key?: string };
  try { body = await req.json(); } catch { return new Response("bad request", { status: 400 }); }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const prepare = () => sb.rpc("push_prepare", { p_secret: secret, p_kind: body.kind ?? "", p_id: body.id ?? null, p_rep_key: body.rep_key ?? null });

  let { data, error } = await prepare();
  if (error || !data || data.error) return new Response("unauthorized", { status: 401 });

  // First run: the server creates its own signing keys (the private key never leaves the database).
  if (data.need_keys) {
    const keys = webpush.generateVAPIDKeys();
    await sb.rpc("push_store_keys", { p_secret: secret, p_pub: keys.publicKey, p_priv: keys.privateKey });
    ({ data, error } = await prepare());
    if (error || !data || data.error || data.need_keys) return new Response("key setup failed", { status: 500 });
  }

  webpush.setVapidDetails(data.subject, data.vapid_public, data.vapid_private);

  const results = await Promise.all((data.messages ?? []).map(async (m: Record<string, string>) => {
    try {
      await webpush.sendNotification(
        { endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } },
        JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }),
        { TTL: 3600, urgency: "high" },
      );
      return "ok";
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.rpc("push_remove", { p_secret: secret, p_endpoint: m.endpoint }); // device unsubscribed
      return `failed:${code ?? (e as Error).message}`;
    }
  }));

  return new Response(JSON.stringify({ sent: results }), { headers: { "Content-Type": "application/json" } });
});
