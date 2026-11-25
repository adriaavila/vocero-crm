import type { Metadata } from "next";
import { productName } from "@/lib/marketing";
import { estadoSolicitud } from "@/server/agencia/meta-cumplimiento";
import { LegalContact, LegalPage } from "@/app/(marketing)/legal-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Estado de tu solicitud · ${productName()}`,
  robots: { index: false },
};

/**
 * Fork — el enlace que Meta le enseña a quien pidió borrar sus datos desde
 * Facebook (la `url` que devuelve `/api/meta/eliminar-datos`). Vive fuera de
 * `(marketing)`: esa superficie es solo del host de Rei, y este enlace tiene
 * que abrir en el host del CRM, sea cual sea la marca.
 */
export default async function EstadoSolicitudPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ codigo?: string }> }>) {
  const { codigo = "" } = await searchParams;
  const solicitud = codigo ? await estadoSolicitud(codigo).catch(() => null) : null;
  const fecha = (d: Date) =>
    d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

  return (
    <LegalPage title="Estado de tu solicitud" updated="31 de octubre de 2026">
      {!solicitud ? (
        <p data-testid="solicitud-no-encontrada">
          No encontramos una solicitud con ese código. Revisa que esté completo o
          escríbenos a <LegalContact /> con el código que te dio Facebook.
        </p>
      ) : (
        <>
          <p>
            Código <strong data-testid="solicitud-codigo">{codigo.trim().toUpperCase()}</strong>,
            recibida el {fecha(solicitud.recibida)}.
          </p>
          {solicitud.estado === "hecha" ? (
            <p data-testid="solicitud-estado">
              <strong>Completada</strong>
              {solicitud.hecha ? ` el ${fecha(solicitud.hecha)}` : ""}.{" "}
              {solicitud.tipo === "desautorizar"
                ? "La conexión de tu cuenta quedó desactivada."
                : "Tus datos fueron eliminados."}
            </p>
          ) : (
            <p data-testid="solicitud-estado">
              <strong>Recibida, en proceso.</strong> Borramos los datos en un
              máximo de 30 días y te confirmamos cuando quede completo. Si tienes
              dudas, escríbenos a <LegalContact />.
            </p>
          )}
        </>
      )}
    </LegalPage>
  );
}
