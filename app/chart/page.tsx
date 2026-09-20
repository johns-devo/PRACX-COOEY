import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocalUserByToken, SESSION_COOKIE } from "../../lib/auth";
import { PatientChartWorkspace } from "../PatientChartWorkspace";

export const dynamic = "force-dynamic";

export default async function Page() {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/");
  return <PatientChartWorkspace currentUser={user} />;
}
