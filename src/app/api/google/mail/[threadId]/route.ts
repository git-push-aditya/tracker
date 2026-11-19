import { requireSession } from "@/lib/auth";
import { GoogleId, ReplyMail, runTool, takeSend, toThread } from "@/lib/google";
import { handle } from "@/lib/http";

export const GET = handle(async (req, ctx: RouteContext<"/api/google/mail/[threadId]">) => {
  const s = await requireSession(req, "integrations:google");
  const thread_id = GoogleId.parse((await ctx.params).threadId);
  return Response.json(toThread(await runTool(s.user.id, "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", { thread_id })));
});

// Plain-text reply in this thread. Never retried: a timeout may still have sent it.
export const POST = handle(async (req, ctx: RouteContext<"/api/google/mail/[threadId]">) => {
  const s = await requireSession(req, "integrations:google");
  const thread_id = GoogleId.parse((await ctx.params).threadId);
  const { to, body } = ReplyMail.parse(await req.json());
  takeSend(s.user.id);
  await runTool(s.user.id, "GMAIL_REPLY_TO_THREAD", { thread_id, recipient_email: to[0], extra_recipients: to.slice(1), message_body: body, is_html: false });
  return Response.json({ ok: true });
});
