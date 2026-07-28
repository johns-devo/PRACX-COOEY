import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocalUserByToken, SESSION_COOKIE } from "../lib/auth";
import { OperationsWorkspace, type OperationsModule } from "./OperationsWorkspace";

export async function AuthenticatedOperationsPage({ module }: { module: OperationsModule }) {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/");
  return <OperationsWorkspace currentUser={user} module={module} />;
}
