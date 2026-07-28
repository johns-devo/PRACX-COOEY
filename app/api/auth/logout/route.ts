import {
  destroyLocalSession,
  expiredSessionCookie,
  readSessionToken,
} from "../../../../lib/auth";

export async function POST(request: Request) {
  await destroyLocalSession(readSessionToken(request));
  const secure = new URL(request.url).protocol === "https:";
  return Response.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": expiredSessionCookie(secure),
      },
    },
  );
}
