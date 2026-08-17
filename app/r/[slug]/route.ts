import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";
import { RECIPIENT_TOKEN_PARAM } from "@/lib/tracking/recipient-token";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

/**
 * Forward the attribution context to the destination.
 *
 * `t` identifies the individual recipient; `utm_term` identifies which of our
 * own Instagram accounts produced the traffic (two accounts both report
 * utm_source=ig, so without this they are indistinguishable downstream).
 *
 * Existing params on the destination win — a campaign URL that already sets one
 * of these was set deliberately.
 */
function withAttribution(
  destinationUrl: string,
  recipientToken: string | null,
  accountUsername: string | null
): string {
  try {
    const url = new URL(destinationUrl);

    if (recipientToken && !url.searchParams.has(RECIPIENT_TOKEN_PARAM)) {
      url.searchParams.set(RECIPIENT_TOKEN_PARAM, recipientToken);
    }
    if (accountUsername && !url.searchParams.has("utm_term")) {
      url.searchParams.set("utm_term", accountUsername.toLowerCase());
    }

    return url.toString();
  } catch {
    // A destination we can't parse is still a destination — never drop a click
    // on the floor over a malformed URL.
    return destinationUrl;
  }
}

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
          instagramAccount: {
            select: { username: true },
          },
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  // Read off request.url rather than request.nextUrl — this route is exercised
  // with a plain Request in tests, and nextUrl is a NextRequest-only property.
  const recipientToken =
    new URL(request.url).searchParams.get(RECIPIENT_TOKEN_PARAM) || null;

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      recipientToken,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  return NextResponse.redirect(
    withAttribution(
      trackedLink.destinationUrl,
      recipientToken,
      trackedLink.automation.instagramAccount?.username ?? null
    ),
    { status: 302 }
  );
}
