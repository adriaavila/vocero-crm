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
    description: "Consulta características de las casas, precios, amenidades y solicita agendar una visita.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, buenas tardes. Vi información del condominio Santorini en Miraflores.",
      "¿Tienen casas disponibles y cuántos metros cuadrados construidos tienen?",
      "¿Qué precio tienen y qué amenidades incluye el condominio?",
      "Me interesa mucho para mi familia. ¿Cómo podemos coordinar una visita para conocer el condominio?",
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios y pagos",
    description: "Pregunta precios de las unidades, fechas de entrega y facilidades o planes de pago.",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Hola, ¿cuál es el precio de la casa más económica en Santorini?",
      "¿Y cuál es el rango de precios de las demás viviendas?",
      "¿Para qué fechas están programadas las entregas de las casas?",
      "¿Tienen algún descuento por pago al contado o facilidades de financiamiento?",
      "Perfecto, lo voy a evaluar con mi familia, gracias.",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Lead escéptico / Plazos y garantías",
    description: "Pregunta con cautela sobre avance de obra, planos, licencias y garantías de entrega.",
    phone: "5210000000003",
    contactName: "[Prueba] Lead escéptico",
    script: [
      "Buenas tardes, vi los anuncios pero quiero saber si las casas ya están listas para entrega inmediata.",
      "¿Quién garantiza las fechas de entrega? Muchos proyectos se retrasan.",
      "¿El proyecto cuenta con arquitecto registrado y aprobación?",
      "Entendido, muchas gracias por la aclaración.",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta por opciones no ofrecidas (lotes vacíos, alquiler temporal / Airbnb).",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, una consulta",
      "¿Venden terrenos o lotes solos sin construir dentro de Santorini?",
      "¿Y se permite comprar para alquiler temporario por Airbnb?",
      "¿Tienen proyectos similares en otras ciudades además de Tarija?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un asesor humano",
    description: "Quiere hablar directamente con el responsable comercial de SAMER (debe escalar).",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Tengo una propuesta económica y quiero hacer una oferta formal por una vivienda.",
      "Prefiero tratar este tema directamente con un asesor o el responsable comercial de SAMER, por favor.",
      "Muchas gracias, espero el contacto.",
    ],
  },
  {
    key: "errores_modismos",
    label: "Mensajes informales y tuteo",
    description: "Escribe con modismos y abreviaciones preguntando por la ubicación y visitas.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "hola buenas, dnd keda santorini?",
      "kiero saber si tienen piscina y si aceptan mascotas",
      "pueden pasar fotos o render d la fachada xfa?",
      "dale genial, voy a pasar a ver el lugar esta semana, gracias",
    ],
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
