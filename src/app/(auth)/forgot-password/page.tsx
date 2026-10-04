import { isEmailConfigured } from "@/server/agencia/email";
import { contactChannelSuffix, helpUrl } from "@/components/agencia/allok/setup-contact";
import ForgotPasswordForm from "./forgot-password-form";

export const dynamic = "force-dynamic";

/**
 * "Olvidé mi contraseña". Con el conector de correo apagado la pantalla no
 * pide un correo que nadie va a mandar: dice a dónde escribir, igual que el
 * login (ver server/agencia/email.ts).
 */
export default function ForgotPasswordPage() {
  const contact = helpUrl();
  return (
    <ForgotPasswordForm
      enabled={isEmailConfigured()}
      helpUrl={contact === "#" ? null : contact}
      channelSuffix={contactChannelSuffix()}
    />
  );
}
