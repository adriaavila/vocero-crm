import { headers } from "next/headers";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { isAllokSaaSMode, isSaaSAdminEmail, resolvedRootDomain } from "@/lib/tenant-host";
import { soldSaaSPlans } from "@/lib/saas-plans";
import { isSaaSSelfServe } from "@/server/auth/registration";
import { startUrl } from "@/components/agencia/allok/setup-contact";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";

/**
 * Con el autoservicio apagado, el registro del SaaS le dice a quien llega que
 * el alta se hace con la marca del despliegue. El formulario sólo lo ve un
 * admin, que crea el negocio durante la puesta en marcha
 * (`/api/saas/businesses`). El servidor cierra lo mismo en `/sign-up/email`:
 * esto es la cara, no la cerradura.
 */
export default async function RegisterPage() {
  const soldPlans = soldSaaSPlans(process.env.SAAS_PLANS);
  if (isAllokSaaSMode() && !isSaaSSelfServe()) {
    const session = await getAuth().api.getSession({ headers: await headers() }).catch(() => null);
    if (!isSaaSAdminEmail(session?.user.email)) return <SetupWithUs />;
    return <RegisterForm adminMode soldPlans={soldPlans} brand={brand()} exampleHost={`clinica-perez.${resolvedRootDomain()}`} />;
  }
  return <RegisterForm soldPlans={soldPlans} selfServe={isAllokSaaSMode()} brand={brand()} exampleHost={`clinica-perez.${resolvedRootDomain()}`} />;
}

function SetupWithUs() {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>El alta la hacemos contigo</CardTitle>
        <CardDescription>
          Escríbenos por WhatsApp, nos cuentas qué vendes y a qué hora atiendes, y
          dejamos tu agente andando con tu número de siempre. No tienes que
          configurar nada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <a href={startUrl()} className={cn(buttonVariants(), "h-11 w-full")}>
          Escribir por WhatsApp
        </a>
        <p className="text-center text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Inicia sesión
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
