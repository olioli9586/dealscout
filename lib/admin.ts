import { createHash, timingSafeEqual } from "node:crypto";

// Deciding a run (approve, edit or reject) writes the profile that every
// later run for that company starts from. On a public deployment, set
// V2_ADMIN_TOKEN: deciding then needs it as a bearer token (the run page
// asks for it; MCP clients send it in their Authorization header). Unset,
// as locally and on the preview (behind Vercel's login), anyone can decide.

export const ADMIN_TOKEN_NEEDED = "Deciding runs on this deployment needs the admin token.";

export function canDecide(req: Request): boolean {
  const token = process.env.V2_ADMIN_TOKEN;
  if (!token) return true;
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  // Equal-length digests, which timingSafeEqual needs.
  return timingSafeEqual(sha256(given), sha256(token));
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}
