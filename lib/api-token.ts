/*
 * Token auth for the handful of routes a pipeline needs to call.
 *
 * Everything here authenticates with a next-auth session, which is right for a
 * browser and unusable from anything else: a script cannot hold a rotating
 * cookie, and driving the credentials callback to get one means depending on
 * next-auth's internals rather than on an API. The RoleModel video pipeline
 * finishes a render and wants to hand it over for review without a person in the
 * loop, so it needs a header.
 *
 * Deliberately NOT a database table. A token model means a Prisma migration,
 * which means this fork carries a schema change that has to be rebased on every
 * upstream migration — for a self-hosted instance used by one team, that is a
 * maintenance bill with no benefit. Tokens live in the environment and map to an
 * existing user, so the fork's diff stays reviewable and rebasing stays cheap:
 *
 *   OPENFRAME_API_TOKENS="tok_abc123:dallas.peters@rolemodelsoftware.com"
 *
 * The token acts AS that user. It gets no more access than they have, which is
 * the property that makes this safe to add — `checkProjectAccess` and every
 * other authorisation check downstream are untouched and still do their job.
 *
 * Comparison is timing-safe. Tokens are bearer credentials and a length-or-prefix
 * leak is a real weakness, cheap to avoid.
 */
import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

/**
 * The shape route handlers already destructure, so call sites do not change.
 *
 * `name` is here because a route uses it: adding a video notifies the project
 * owner with `session.user.name || 'A team member'`. Leaving it off compiled
 * against a session and failed against a token, which the build caught — and had
 * it not, a token-added video would have credited nobody.
 */
export type ResolvedSession = {
  user: { id: string; email?: string | null; name?: string | null };
} | null;

/** A token has to be long enough that guessing it is not a strategy. */
const MIN_TOKEN_LENGTH = 24;

type TokenMap = Map<string, string>;
let cached: { raw: string; map: TokenMap } | null = null;

/**
 * Parse `OPENFRAME_API_TOKENS` into token -> email.
 *
 * Cached on the raw string rather than on first read, so changing the variable
 * and restarting picks it up without a stale map surviving in a warm lambda.
 * Short tokens are dropped rather than accepted, and say so in the log: silently
 * ignoring a misconfigured credential is how you end up debugging a 401 against
 * a token the server decided not to honour.
 */
function tokens(): TokenMap {
  const raw = process.env.OPENFRAME_API_TOKENS ?? '';
  if (cached && cached.raw === raw) return cached.map;

  const map: TokenMap = new Map();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(':');
    if (at === -1) {
      console.warn('OPENFRAME_API_TOKENS: entry is not `token:email`, ignoring one');
      continue;
    }
    const token = trimmed.slice(0, at).trim();
    const email = trimmed
      .slice(at + 1)
      .trim()
      .toLowerCase();
    if (!token || !email) continue;
    if (token.length < MIN_TOKEN_LENGTH) {
      console.warn(
        `OPENFRAME_API_TOKENS: ignoring a token shorter than ${MIN_TOKEN_LENGTH} characters`
      );
      continue;
    }
    map.set(token, email);
  }
  cached = { raw, map };
  return map;
}

/** Constant-time lookup: comparing every entry, and not returning early. */
function emailForToken(presented: string): string | null {
  const presentedBuf = Buffer.from(presented);
  let found: string | null = null;
  for (const [token, email] of tokens()) {
    const known = Buffer.from(token);
    const same = known.length === presentedBuf.length && timingSafeEqual(known, presentedBuf);
    if (same) found = email;
  }
  return found;
}

/** The bearer token on a request, from either header we accept. */
function presentedToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const value = authorization.slice(7).trim();
    if (value) return value;
  }
  const header = request.headers.get('x-openframe-token');
  return header?.trim() || null;
}

/**
 * A session for this request, from a cookie or a token.
 *
 * Session first: a browser request should not pay for a token lookup, and a
 * signed-in user with a stale token header should still be themselves.
 */
export async function authFromRequest(request: NextRequest): Promise<ResolvedSession> {
  const session = await auth();
  if (session?.user?.id) return session as ResolvedSession;

  const presented = presentedToken(request);
  if (!presented) return null;

  const email = emailForToken(presented);
  if (!email) return null;

  // The token names a user who has to exist. A token for a deleted account is a
  // 401, not an anonymous session with a project's worth of access.
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.warn(`OPENFRAME_API_TOKENS: no user for a configured token's email`);
    return null;
  }
  return { user: { id: user.id, email: user.email, name: user.name } };
}

/** Whether token auth is configured at all, for a diagnostic to report. */
export const apiTokensConfigured = (): boolean => tokens().size > 0;
