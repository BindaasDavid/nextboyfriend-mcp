const DEFAULT_NOTIFY_TO = "david@dashworth.com";

export type CreditsNotifyDetail = {
  articleTitle: string;
  errorSnippet: string;
};

/**
 * Email alert when Anthropic credits are depleted (Resend HTTP API).
 * Set RESEND_API_KEY (GitHub secret) and optionally AUTOMATION_EMAIL_FROM (verified domain in Resend).
 */
export async function notifyAnthropicCreditsDepleted(detail: CreditsNotifyDetail): Promise<void> {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  const to = (process.env.AUTOMATION_NOTIFY_EMAIL ?? DEFAULT_NOTIFY_TO).trim();
  const from = (
    process.env.AUTOMATION_EMAIL_FROM ?? "Next Boyfriend <onboarding@resend.dev>"
  ).trim();

  if (!key) {
    console.warn(
      `[automation] Credits depleted alert not emailed (set RESEND_API_KEY). Would notify: ${to}`,
    );
    return;
  }

  const text = [
    "The TikTok automation could not call Claude because Anthropic reported insufficient API credits.",
    "Fallback: template caption (article excerpt) and default hashtags were used; Pollinations + SocialAPI unchanged.",
    "",
    `Article: ${detail.articleTitle}`,
    "",
    "Add credits: https://console.anthropic.com/settings/plans",
    "",
    `Error (truncated): ${detail.errorSnippet.slice(0, 800)}`,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Next Boyfriend automation: Anthropic credits depleted (template fallback used)",
      text,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.warn(`[automation] Resend failed (${res.status}): ${t.slice(0, 300)}`);
    return;
  }
  console.log(`[automation] Sent credits alert email to ${to}`);
}
