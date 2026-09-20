import { AuthenticatedBillingPage } from "../../../AuthenticatedBillingPage";
export const dynamic = "force-dynamic";
export default function Page() {
  return <AuthenticatedBillingPage module="payers" variant="pracx" />;
}
