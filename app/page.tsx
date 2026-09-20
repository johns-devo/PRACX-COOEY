import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocalUserByToken, SESSION_COOKIE } from "../lib/auth";
import { LoginScreen } from "./LoginScreen";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const user = await getLocalUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (user) redirect("/dashboard");
  return <LoginScreen />;
}
