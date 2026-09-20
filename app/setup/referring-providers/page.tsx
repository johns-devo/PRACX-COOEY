import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProviderWorkspace } from "../../ProviderWorkspace";
import { getLocalUserByToken, SESSION_COOKIE } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function ReferringProvidersPage() {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/");
  return <ProviderWorkspace currentUser={user} kind="referring" />;
}
