import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { brand } from "@/lib/brand";
import { isAllokSaaSMode, isSaaSAdminHost, isSaaSAppHost, tenantSlugFromHost } from "@/lib/tenant-host";

export default async function Home() {
  if (isAllokSaaSMode()) {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (isSaaSAdminHost(host)) redirect("/admin");
    // Rei: la raíz del host de alta es la portada pública, como
    // crm.reiprop.tech/ en el fork viejo. allok conserva su "/" de siempre
    // (entra a /overview y de ahí a /login si no hay sesión) — un negocio en
    // su propio subdominio (tenantSlugFromHost) tampoco pasa por acá.
    if (brand().id === "rei" && isSaaSAppHost(host) && !tenantSlugFromHost(host)) {
      redirect("/inicio");
    }
  }
  redirect("/overview");
}
