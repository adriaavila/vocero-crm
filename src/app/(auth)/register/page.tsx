import { headers } from "next/headers";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { isAllokSaaSMode, isSaaSAdminEmail } from "@/lib/tenant-host";
import { SAAS_SELF_SERVE } from "@/server/auth/registration";
import { ALLOK_START_URL } from "@/components/agencia/allok/setup-contact";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";

/**
 * Con el autoservicio apagado, el registro del SaaS le dice a quien llega que
 * el alta se hace con allok. El formulario sólo lo ve un admin de allok, que
 * crea el negocio durante la puesta en marcha. El servidor cierra lo mismo en
 * `/sign-up/email`: esto es la cara, no la cerradura.
 */
export default async function RegisterPage() {
  if (isAllokSaaSMode() && !SAAS_SELF_SERVE) {
    const session = await getAuth().api.getSession({ headers: await headers() }).catch(() => null);
    if (!isSaaSAdminEmail(session?.user.email)) return <SetupWithUs />;
  }
  return <RegisterForm />;
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
        <a href={ALLOK_START_URL} className={cn(buttonVariants(), "h-11 w-full")}>
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
