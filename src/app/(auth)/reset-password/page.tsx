import ResetPasswordForm from "./reset-password-form";

export const dynamic = "force-dynamic";

/**
 * Destino del enlace del correo. Better Auth valida el token al abrir el
 * enlace (`/api/auth/reset-password/<token>`) y redirige aquí con
 * `?token=...`, o con `?error=INVALID_TOKEN` si venció o ya no existe. Sin
 * token cae al mismo mensaje: llegar aquí a mano no es un error del usuario.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={error ? null : (token ?? null)} />;
}
