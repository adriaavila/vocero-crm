import { idBoton } from "@/lib/sala-whatsapp";

/**
 * BORRADOR de la plantilla para volver a escribirle a un lead viejo (fuera
 * de las 24 h, Meta solo deja escribir con una plantilla aprobada). No se
 * manda sola a Meta: es el cuerpo exacto de `POST /{waba}/message_templates`
 * para que el dueño la revise, la apruebe la constructora y recién ahí se
 * dé de alta (desde Plantillas o con este JSON).
 *
 * Sus dos respuestas rápidas llevan, al enviarse, el mismo id que los
 * botones de la sala (`sala:cuota:<casa>`, `sala:visita:<casa>`): el toque
 * cae en `atenderSalaEnWhatsapp` igual que en una conversación abierta.
 *
 * `{{2}}` es LA novedad que justifica escribirle ("abrimos visitas los
 * sábados", "se liberó una casa"). Sin novedad no hay plantilla: es lo que
 * separa reactivar de hacer spam. Pasa por `palabrasProhibidas` como todo
 * lo que lee el comprador, y no lleva porcentajes de avance de obra.
 */
export const PLANTILLA_SALA = {
  name: "sala_venta_novedad",
  language: "es",
  category: "MARKETING",
  components: [
    {
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["<subir la foto de la casa modelo con la API de carga de Meta>"] },
    },
    {
      type: "BODY",
      text:
        "Hola {{1}}, hace un tiempo nos preguntaste por una casa. {{2}}\n\n" +
        "Te armamos tu sala con las casas que te pueden servir y lo que pagarías con el plan aprobado. ¿Quieres verla?",
      example: {
        body_text: [["María", "Ya está lista la casa modelo y abrimos visitas los sábados."]],
      },
    },
    {
      type: "FOOTER",
      text: "Si ya no te interesa, respóndenos «no» y no te escribimos más.",
    },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Ver lo que pagaría" },
        { type: "QUICK_REPLY", text: "Quiero visitar" },
        {
          type: "URL",
          text: "Ver tu sala",
          url: "https://crm.reiprop.tech/s/{{1}}",
          example: ["https://crm.reiprop.tech/s/ejemploDeToken1234567890"],
        },
      ],
    },
  ],
} as const;

/** Los textos de la plantilla que leerá el comprador, para revisarlos de una vez. */
export function textosPlantilla(): string[] {
  const textos: string[] = [];
  for (const c of PLANTILLA_SALA.components) {
    if ("text" in c) textos.push(c.text);
    if (c.type === "BODY") textos.push(...c.example.body_text[0]);
    if (c.type === "BUTTONS") textos.push(...c.buttons.map((b) => b.text));
  }
  return textos;
}

/**
 * Los `components` de un envío (`type: "template"`). La imagen va por link
 * público; el botón de URL lleva el token de la sala, y las respuestas
 * rápidas el id de la casa que se le ofrece.
 */
export function componentesDeEnvio(input: {
  nombre: string;
  novedad: string;
  fotoUrl: string;
  token: string;
  casaId: string;
}) {
  return [
    { type: "header", parameters: [{ type: "image", image: { link: input.fotoUrl } }] },
    {
      type: "body",
      parameters: [
        { type: "text", text: input.nombre },
        { type: "text", text: input.novedad },
      ],
    },
    {
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: idBoton({ accion: "cuota", casaId: input.casaId }) }],
    },
    {
      type: "button",
      sub_type: "quick_reply",
      index: "1",
      parameters: [{ type: "payload", payload: idBoton({ accion: "visita", casaId: input.casaId }) }],
    },
    { type: "button", sub_type: "url", index: "2", parameters: [{ type: "text", text: input.token }] },
  ];
}
