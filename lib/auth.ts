import NextAuth, { type NextAuthConfig } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

const emailFrom = process.env.EMAIL_FROM ?? "OpenReply <login@example.com>";
// Setting EMAIL_SERVER switches magic links to your own SMTP server, for
// self-hosters who do not want a third-party mail service. Resend stays the
// default, so an existing deployment is unaffected.
const smtpServer = process.env.EMAIL_SERVER;

/**
 * Provider id the login form has to sign in with. It differs per transport,
 * so it is derived here rather than hardcoded at the call site.
 */
export const EMAIL_PROVIDER_ID = smtpServer ? "nodemailer" : "resend";

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    // Upstream added an SMTP fallback; keep it, and brand the Resend path —
    // that's the one this deployment uses.
    smtpServer
      ? Nodemailer({ server: smtpServer, from: emailFrom })
      : Resend({
          apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
          from: emailFrom,
          // The stock Auth.js email is unbranded and reads like a system
          // notice. It's the first thing anyone sees from the tool, so it
          // uses the Incension chassis instead.
          async sendVerificationRequest({ identifier, url, provider }) {
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${provider.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: provider.from,
                to: identifier,
                subject: "Your Incension sign-in link",
                text: `Sign in to Incension: ${url}\n\nThis link expires shortly. If you didn't request it, ignore this email.`,
                html: incensionSignInEmail(url),
              }),
            });

            if (!res.ok) {
              throw new Error(
                `Resend rejected the sign-in email: ${await res.text()}`
              );
            }
          },
        }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    strategy: "database",
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}

/**
 * Branded magic-link email. Inline styles only — email clients strip
 * stylesheets, and web fonts fall back to Georgia / Helvetica, which is why
 * the stack names them explicitly.
 */
function incensionSignInEmail(url: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fcff;font-family:Lato,Helvetica,Arial,sans-serif;color:#3d5a6b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fcff;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid rgba(74,143,181,0.22);border-radius:14px;box-shadow:0 6px 24px rgba(42,96,128,0.06);overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(180deg,#c8dff0 0%,#daedf8 100%);padding:28px 32px;">
                <div style="font-size:10.5px;letter-spacing:0.25em;text-transform:uppercase;color:#4a8fb5;">Incension</div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px 32px;">
                <h1 style="margin:0 0 12px 0;font-family:Georgia,'Playfair Display',serif;font-weight:300;font-size:28px;line-height:1.25;color:#1a2830;">Your sign-in link</h1>
                <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:#3d5a6b;">Tap below and you're in. No password to remember.</p>
                <a href="${url}" style="display:inline-block;background:#2a6080;color:#ffffff;text-decoration:none;font-size:15px;padding:14px 32px;border-radius:999px;box-shadow:0 6px 18px rgba(42,96,128,0.25);">Sign in</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#7a9aaa;">This link expires shortly and can only be used once. If you didn't ask for it, you can ignore this email safely.</p>
              </td>
            </tr>
          </table>
          <p style="max-width:520px;margin:20px auto 0 auto;font-size:11px;letter-spacing:0.06em;color:#7a9aaa;">Inner peace is the new rich.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
