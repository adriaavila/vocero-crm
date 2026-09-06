/**
 * Las 6 personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 */

export type Persona = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
};

export const PERSONAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Comprador decidido",
    description: "Pregunta por la oferta, confirma precio y muestra intención clara de compra.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, vi información de su negocio y me interesa comprar.",
      "¿Qué productos o servicios tienen disponibles?",
      "¿Cuál es el precio y qué incluye?",
      "Perfecto, quiero avanzar. ¿Cuál es el siguiente paso?",
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios y pagos",
    description: "Pregunta precios, disponibilidad, entrega y formas de pago.",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Hola, ¿me comparten sus precios?",
      "¿Qué opciones tienen disponibles ahora?",
      "¿Cuánto tarda la entrega o la puesta en marcha?",
      "¿Qué formas de pago aceptan?",
      "Perfecto, lo voy a evaluar, gracias.",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Reporta un problema y espera una respuesta empática sin promesas inventadas.",
    phone: "5210000000003",
    contactName: "[Prueba] Lead escéptico",
    script: [
      "Estoy molesto porque tuve un problema con lo que recibí.",
      "Ya expliqué esto antes y necesito una solución.",
      "¿Qué pueden hacer para ayudarme?",
      "Gracias, quedo pendiente.",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta por políticas que podrían no estar en el conocimiento cargado.",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, tengo una consulta.",
      "¿Cuál es su política exacta de garantías y devoluciones?",
      "¿Tienen excepciones para compras internacionales?",
      "¿Me puedes confirmar esa información por escrito?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un asesor humano",
    description: "Pide hablar directamente con una persona del equipo (debe escalar).",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Tengo una consulta comercial que prefiero tratar con una persona.",
      "Quiero hablar directamente con un asesor humano, por favor.",
      "Muchas gracias, espero el contacto.",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con errores, abreviaciones y lenguaje informal.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "hola ke onda, ke venden?",
      "kiero saber cuanto cuesta y si ai disponible",
      "me pasan mas info xfa?",
      "dale genial, gracias",
    ],
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
