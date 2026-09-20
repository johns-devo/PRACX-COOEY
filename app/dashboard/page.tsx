import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AnalyticsDashboard } from "../AnalyticsDashboard";
import { getLocalUserByToken, SESSION_COOKIE } from "../../lib/auth";
import { getOnboardingState } from "../../lib/onboarding";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/");
  const onboarding = await getOnboardingState();
  if (!onboarding.completed) redirect("/setup");
  return <AnalyticsDashboard currentUser={user} />;
}
