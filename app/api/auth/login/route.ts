import {
  authenticateLocalUser,
  createLocalSession,
  sessionCookie,
} from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; password?: string };
    const email = payload.email?.trim() ?? "";
    const password = payload.password ?? "";

    if (!email || !password) {
      return Response.json(
        { error: "Enter your email address and password." },
        { status: 400 },
      );
    }

    const user = await authenticateLocalUser(email, password);
    if (!user) {
      return Response.json(
        { error: "The email address or password is incorrect." },
        { status: 401 },
      );
    }

    const { token, expiresAt } = await createLocalSession(user.id);
    const secure = new URL(request.url).protocol === "https:";
    return Response.json(
      { user },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": sessionCookie(token, expiresAt, secure),
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Sign in is temporarily unavailable." },
      { status: 500 },
    );
  }
}
