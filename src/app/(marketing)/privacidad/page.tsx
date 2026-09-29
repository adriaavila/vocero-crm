import type { Metadata } from "next";
import { productName } from "@/lib/marketing";
import { LegalContact, LegalEntity, LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: `Política de privacidad — ${productName()}`,
  description: "Qué datos trata Rei CRM, con qué fin, cuánto los guarda y cómo pedir que se borren.",
};

export default function PrivacyPage() {
  const name = productName();
  return (
    <LegalPage title="Política de privacidad" updated="29 de septiembre de 2026">
      <p>
        <LegalEntity /> desarrolla y opera {name}, un sistema que permite a una
        inmobiliaria atender su WhatsApp con ayuda de un agente automático.
        Esta política explica qué datos se tratan y por qué.
      </p>

      <h2>Quién responde por tus datos</h2>
      <p>
        Si escribiste por WhatsApp a una inmobiliaria que usa {name},{" "}
        <strong>esa inmobiliaria decide qué hace con tus datos</strong>. Nosotros
        los tratamos por encargo suyo y siguiendo sus instrucciones. Para pedir
        una copia, una corrección o un borrado, lo más rápido es escribirle
        directamente a ella; si no sabes cómo, escríbenos y te ponemos en
        contacto.
      </p>

      <h2>Qué se trata</h2>
      <ul>
        <li>
          <strong>Tu número de teléfono y el nombre</strong> que muestra tu
          perfil de WhatsApp.
        </li>
        <li>
          <strong>Los mensajes</strong> que intercambias con la inmobiliaria,
          incluidas imágenes o audios que envíes.
        </li>
        <li>
          <strong>Lo que buscas</strong>: operación (venta, alquiler o
          anticrético), zona, presupuesto, dormitorios y forma de pago, cuando
          lo dices en la conversación.
        </li>
        <li>
          <strong>Las visitas</strong> que agendes y su estado.
        </li>
      </ul>
      <p>
        No se piden ni se guardan datos de tarjetas, documentos de identidad ni
        contraseñas dentro de la conversación.
      </p>

      <h2>Para qué</h2>
      <ul>
        <li>Responder tus consultas y mostrarte propiedades del catálogo.</li>
        <li>Agendar visitas y recordarlas.</li>
        <li>Que el equipo de la inmobiliaria retome la conversación donde quedó.</li>
        <li>
          Medir y mejorar la calidad de las respuestas del agente, sobre
          conversaciones reales de esa misma inmobiliaria.
        </li>
      </ul>

      <h2>Inteligencia artificial</h2>
      <p>
        Las respuestas las redacta un modelo de lenguaje de un proveedor
        externo. Para eso, el contenido de la conversación y la parte del
        catálogo que hace falta se envían a ese proveedor en el momento de
        responder. El modelo solo puede ofrecer propiedades que existen en el
        catálogo cargado.
      </p>

      <h2>Con quién se comparten</h2>
      <ul>
        <li>
          <strong>Meta (WhatsApp Business)</strong>, porque es el canal por el
          que viajan los mensajes.
        </li>
        <li>
          <strong>El proveedor del modelo de lenguaje</strong>, para generar la
          respuesta.
        </li>
        <li>
          <strong>El proveedor de infraestructura</strong> donde corre el
          sistema y vive la base de datos.
        </li>
      </ul>
      <p>No se venden datos personales ni se ceden a terceros para publicidad.</p>

      <h2>Cuánto tiempo</h2>
      <p>
        Las conversaciones se conservan mientras la inmobiliaria sea cliente, y
        se eliminan dentro de los 90 días de terminado el servicio o de
        recibido un pedido de borrado. Las credenciales de acceso a WhatsApp se
        guardan cifradas.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Puedes pedir acceso, corrección, borrado, u oponerte al tratamiento.
        Escribe a <LegalContact /> o sigue los pasos de{" "}
        <a href="/eliminar-datos">eliminar mis datos</a>. Se responde dentro de
        los 30 días.
      </p>

      <h2>Cambios</h2>
      <p>
        Si esta política cambia de forma relevante, se actualiza la fecha de
        arriba y se avisa a las inmobiliarias que usan el sistema.
      </p>
    </LegalPage>
  );
}
