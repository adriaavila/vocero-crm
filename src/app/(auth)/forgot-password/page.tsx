import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/agencia/forgot-password-form";
import { emailEnabled } from "@/server/agencia/email";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Recuperar contraseña</CardTitle>
      </CardHeader>
      <CardContent>
        {emailEnabled() ? (
          <ForgotPasswordForm />
        ) : (
          // Sin conector de correo no hay enlace que mandar: el camino es el
          // de siempre, `scripts/reset-password.mjs` en manos del propietario.
          <p className="text-sm text-muted-foreground">
            Pide al propietario de la cuenta que restablezca tu contraseña.
          </p>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
