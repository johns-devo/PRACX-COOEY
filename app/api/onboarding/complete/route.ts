import { getLocalUserFromRequest } from "../../../../lib/auth";
import { completeOnboarding } from "../../../../lib/onboarding";

export async function POST(request: Request) {
  const user = await getLocalUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (user.role !== "administrator") {
    return Response.json(
      { error: "Administrator access is required." },
      { status: 403 },
    );
  }

  const result = await completeOnboarding();
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result);
}
