import type { Metadata } from "next";
import { productName } from "@/lib/marketing";
import { LegalContact, LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: `Eliminar mis datos — ${productName()}`,
  description: "Cómo pedir que se borren tus datos de Rei CRM, qué se borra y en cuánto tiempo.",
};

export default function DataDeletionPage() {
  const name = productName();
  return (
    <LegalPage title="Eliminar mis datos" updated="29 de septiembre de 2026">
      <p>
        Puedes pedir que se borre todo lo que {name} guarda sobre ti. No hace
        falta explicar por qué.
      </p>

      <h2>Si escribiste a una inmobiliaria</h2>
      <p>
        La inmobiliaria con la que hablaste es quien decide sobre esos datos,
        así que lo más rápido es pedírselo a ella. Si prefieres, escríbenos a{" "}
        <LegalContact /> desde el mismo número o con el número en el mensaje, y
        lo tramitamos con ella.
      </p>
      <p>Pon en el mensaje:</p>
      <ul>
        <li>El número de WhatsApp desde el que escribiste.</li>
        <li>El nombre de la inmobiliaria, si lo recuerdas.</li>
        <li>La frase &quot;solicito la eliminación de mis datos&quot;.</li>
      </ul>

      <h2>Si eres una inmobiliaria cliente</h2>
      <p>
        Pídelo desde el correo del titular de la cuenta. Se elimina la
        organización entera: conversaciones, contactos, catálogo, visitas y
        credenciales de WhatsApp. Antes del borrado se te ofrece una exportación.
      </p>

      <h2>Qué se borra</h2>
      <ul>
        <li>Tu número de teléfono y tu nombre de perfil.</li>
        <li>Todos los mensajes intercambiados, y sus imágenes y audios.</li>
        <li>Lo que se hubiera registrado sobre lo que buscabas.</li>
        <li>Las visitas agendadas y su historial.</li>
      </ul>

      <h2>Qué puede quedar</h2>
      <p>
        Registros técnicos sin contenido de conversación —fecha, código de
        respuesta— que se rotan solos, y lo que haya que conservar por una
        obligación legal, como comprobantes de facturación de una inmobiliaria
        cliente. Meta conserva sus propios registros de entrega según sus
        políticas, fuera de nuestro alcance.
      </p>

      <h2>Cuánto tarda</h2>
      <p>
        Se confirma la recepción dentro de las 72 horas y se completa el
        borrado dentro de los 30 días. Si el pedido se rechaza —por ejemplo, si
        no se puede verificar quién lo pide— se explica el motivo.
      </p>
    </LegalPage>
  );
}
