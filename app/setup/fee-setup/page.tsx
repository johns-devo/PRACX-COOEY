import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocalUserByToken, SESSION_COOKIE } from "../../../lib/auth";
import { FeeSetupWorkspace } from "../../FeeSetupWorkspace";

export const dynamic = "force-dynamic";
export default async function FeeSetupPage() {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/");
  if (user.role.toLowerCase() !== "administrator") redirect("/dashboard");
  return <FeeSetupWorkspace currentUser={user} />;
}
