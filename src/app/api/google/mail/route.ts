import { requireSession } from "@/lib/auth";
import { params, runTool, SearchParams, SendMail, takeSend, toMailList } from "@/lib/google";
import { handle } from "@/lib/http";

// A folder or Gmail search (`q` uses Gmail's own search syntax, on the user's own mailbox).
export const GET = handle(async (req) => {
  const s = await requireSession(req, "integrations:google");
  const { q, page } = SearchParams.parse(params(req));
  const data = await runTool(s.user.id, "GMAIL_FETCH_EMAILS", {
    query: q || "in:inbox", max_results: 20, page_token: page, include_payload: false, verbose: false,
    include_spam_trash: /\bin:(spam|trash)\b/.test(q), // Gmail hides these otherwise, even when asked for by query
  });
  return Response.json(toMailList(data));
});

// Send a new plain-text email as this user. Never retried: a timeout may still have sent it.
export const POST = handle(async (req) => {
  const s = await requireSession(req, "integrations:google");
  const { to, cc, subject, body } = SendMail.parse(await req.json());
  takeSend(s.user.id);
  await runTool(s.user.id, "GMAIL_SEND_EMAIL", { recipient_email: to[0], extra_recipients: to.slice(1), cc, subject, body, is_html: false });
  return Response.json({ ok: true });
});
