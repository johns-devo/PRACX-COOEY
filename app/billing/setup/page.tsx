import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FacilityWorkspace } from "../../FacilityWorkspace";
import { getLocalUserByToken, SESSION_COOKIE } from "../../../lib/auth";
import { getOnboardingState } from "../../../lib/onboarding";

export const dynamic = "force-dynamic";

export default async function BillingSetupPage() {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/");
  const onboarding = await getOnboardingState();
  return (
    <FacilityWorkspace
      currentUser={user}
      onboardingCompleted={onboarding.completed}
      variant="billing"
    />
  );
}
