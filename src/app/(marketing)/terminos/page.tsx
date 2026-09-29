import type { Metadata } from "next";
import { productName } from "@/lib/marketing";
import { LegalContact, LegalEntity, LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: `Términos del servicio — ${productName()}`,
  description: "Condiciones de uso de Rei CRM: qué incluye, qué se espera de quien lo contrata, cobro y baja.",
};

export default function TermsPage() {
  const name = productName();
  return (
    <LegalPage title="Términos del servicio" updated="29 de septiembre de 2026">
      <p>
        Estos términos regulan el uso de {name}, provisto por <LegalEntity />.
        Contratar el servicio implica aceptarlos.
      </p>

      <h2>Qué es el servicio</h2>
      <p>
        Un sistema de gestión de conversaciones de WhatsApp para inmobiliarias,
        con un agente automático que responde sobre el catálogo que cargues
        (venta, alquiler o anticrético), califica consultas y agenda visitas.
        Se ofrece como servicio compartido, con un subdominio propio, o como
        instancia dedicada.
      </p>

      <h2>Tu cuenta</h2>
      <ul>
        <li>Eres responsable de lo que hagan las personas a las que les des acceso.</li>
        <li>
          Tienes que tener derecho a usar el número de WhatsApp que conectes y
          cumplir las políticas de WhatsApp Business de Meta.
        </li>
        <li>
          El contenido que cargues —propiedades, precios, fotos, textos— es
          tuyo y respondes por su veracidad.
        </li>
      </ul>

      <h2>Qué no se puede hacer</h2>
      <ul>
        <li>Enviar mensajes no solicitados a listas compradas o sin consentimiento.</li>
        <li>Usar el sistema para algo que no sea la actividad inmobiliaria acordada.</li>
        <li>Intentar acceder a datos de otra agencia, o a la infraestructura.</li>
        <li>Revender el acceso sin acuerdo previo por escrito.</li>
      </ul>
      <p>
        Meta puede limitar o dar de baja un número que incumpla sus políticas.
        Eso está fuera de nuestro control.
      </p>

      <h2>El agente automático</h2>
      <p>
        El agente está diseñado para responder únicamente con información del
        catálogo cargado y para derivar a una persona cuando no sabe algo,
        cuando se negocia un precio o cuando se piden condiciones legales o de
        crédito. Aun así, <strong>es un sistema automático y puede
        equivocarse</strong>. Revisa las conversaciones: la responsabilidad
        frente a tu cliente final sigue siendo tuya. El agente no cierra
        operaciones ni firma nada.
      </p>

      <h2>Disponibilidad</h2>
      <p>
        Se trabaja para que el servicio esté disponible de forma continua, pero
        no se garantiza que no haya interrupciones. Las tareas de mantenimiento
        que requieran corte se avisan con antelación cuando es posible.
      </p>

      <h2>Precio y cobro</h2>
      <p>
        El precio es el del plan contratado, en dólares estadounidenses, por
        mes adelantado. Los impuestos que correspondan van aparte. Un cambio de
        precio se avisa con 30 días de antelación.
      </p>

      <h2>Baja</h2>
      <p>
        Puedes darte de baja cuando quieras, sin permanencia. El servicio sigue
        activo hasta el final del período pagado. Puedes pedir una exportación
        de tus datos antes de irte; después de la baja se eliminan según lo que
        dice la <a href="/privacidad">política de privacidad</a>.
      </p>

      <h2>Responsabilidad</h2>
      <p>
        El servicio se presta tal como está. En la medida en que la ley lo
        permita, la responsabilidad total se limita a lo que hayas pagado en
        los últimos 12 meses.
      </p>

      <h2>Contacto</h2>
      <p>Para cualquier duda sobre estos términos: <LegalContact />.</p>
    </LegalPage>
  );
}
