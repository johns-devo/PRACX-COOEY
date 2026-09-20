import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocalUserByToken, SESSION_COOKIE } from "../lib/auth";
import { BillingWorkspace } from "./BillingWorkspace";
import type { OperationsModule } from "./OperationsWorkspace";
import type { WorkspaceVariant } from "../lib/workspace-nav";

export async function AuthenticatedBillingPage({
  module,
  variant = "billing",
}: {
  module: OperationsModule;
  variant?: Extract<WorkspaceVariant, "billing" | "pracx">;
}) {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/");
  return <BillingWorkspace currentUser={user} module={module} variant={variant} />;
}
