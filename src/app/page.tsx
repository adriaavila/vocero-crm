import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAllokSaaSMode, isSaaSAdminHost } from "@/lib/tenant-host";

export default async function Home() {
  if (isAllokSaaSMode()) {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (isSaaSAdminHost(host)) redirect("/admin");
  }
  redirect("/overview");
}
