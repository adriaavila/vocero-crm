import {
  formatPrice,
  formatZone,
  OPERATION_LABELS,
  PAYMENT_METHOD_LABELS,
  PROPERTY_KIND_LABELS,
  PROPERTY_KINDS,
  derivedTitle,
  isOperation,
  isPaymentMethod,
  isPropertyKind,
} from "@/lib/realty/catalog";

/**
 * Las 6 personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 *
 * Una agencia inmobiliaria NO se prueba con estas: "¿qué venden?" o
 * "garantías y devoluciones" hacen fallar a un agente que vende casas, y el
 * puntaje deja de decir nada. Para ellas, `buildRealtyPersonas` arma las
 * personas con SU catálogo (abajo).
 */

export type Persona = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
  /**
   * Qué tiene que pasar para que esta conversación salga verde. Va al juez
   * tal cual: sin esto, el juez adivina qué es "bien" para cada persona.
   */
  expectations: string[];
  /**
   * Con objetivo, el cliente simulado RESPONDE a lo que el agente pregunta
   * (`client-sim.ts`) y el guion queda como guía y respaldo. Sin objetivo,
   * el guion se manda tal cual, línea por línea.
   */
  goal?: string;
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
    expectations: [
      "Explica qué ofrece el negocio solo con datos del conocimiento",
      "Da un siguiente paso concreto (o mueve el lead) ante la intención de compra",
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
    expectations: [
      "Los precios, tiempos y formas de pago que da están en el conocimiento; si no, dice que lo confirma",
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
    expectations: [
      "Responde con empatía y sin prometer soluciones que no están en el conocimiento",
      "Ofrece pasar con una persona si no puede resolver",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta que no está en lo que escribiste",
    description: "Pregunta por políticas que podrían no estar en el conocimiento cargado.",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, tengo una consulta.",
      "¿Cuál es su política exacta de garantías y devoluciones?",
      "¿Tienen excepciones para compras internacionales?",
      "¿Me puedes confirmar esa información por escrito?",
    ],
    expectations: [
      "No inventa políticas: dice que lo confirma con el equipo o escala",
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
    expectations: [
      "Escala a una persona cuando el cliente lo pide",
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
    expectations: [
      "Entiende el mensaje pese a los errores y responde claro, sin inventar",
    ],
  },
];

/* --- Vertical inmobiliario: personas armadas con el catálogo real --- */

/** Lo mínimo de una propiedad que necesita una persona (sin BD: PURA). */
export type CatalogProperty = {
  title: string | null;
  operation: string;
  kind: string;
  price: string | number;
  currency: string;
  neighborhood: string | null;
  city: string | null;
  bedrooms: number | null;
  acceptedPayments: string[];
  /** La ficha del asesor: ahí suelen vivir la entrega y la oferta. */
  description?: string | null;
};

const REALTY_LABELS: Record<string, string> = {
  busca_lo_que_tienes: "Busca justo lo que tienes",
  quiere_visitar: "Quiere ir a ver una propiedad",
  pide_lo_que_no_tienes: "Pide algo que no tienes",
  pregunta_forma_de_pago: "Pregunta cómo pagar",
  pregunta_inversion: "Pregunta si es buena inversión",
  curioso_modismos: "Curioso que escribe como habla",
  pide_asesor: "Pide un asesor humano",
};

/**
 * Siete clientes de inmobiliaria armados con el catálogo de ESTA agencia:
 * buscan una propiedad que existe (con su zona, precio y dormitorios reales),
 * piden visitarla, piden algo que no hay, preguntan por pago e "inversión"…
 * Así el juez puede exigir datos exactos ("dijo el precio de la ficha") en vez
 * de castigar al agente por no vender taladros.
 *
 * PURA: mismo catálogo → mismas personas. `properties` llega ya filtrado a las
 * disponibles y no archivadas; vacío → `[]` (quien llama decide qué avisar).
 */
export function buildRealtyPersonas(properties: CatalogProperty[]): Persona[] {
  const target = properties[0];
  if (!target) return [];

  const kind = isPropertyKind(target.kind)
    ? PROPERTY_KIND_LABELS[target.kind].toLowerCase()
    : "propiedad";
  const operation = isOperation(target.operation)
    ? OPERATION_LABELS[target.operation].toLowerCase()
    : "venta";
  const zone = target.neighborhood?.trim() || target.city?.trim() || "la ciudad";
  const title = target.title?.trim() || derivedTitle(target.kind, target.city);
  const price = Number(target.price);
  const priceText = formatPrice(price, target.currency);
  const budgetText = formatPrice(Math.ceil((price * 1.1) / 1000) * 1000, target.currency);
  const bedrooms = target.bedrooms ?? 2;
  const zoneText = formatZone(target.neighborhood, target.city);

  // Lo que NO hay: un tipo que el catálogo no tiene y más dormitorios que el
  // máximo, a la mitad de precio. Si una agencia tiene de todo, igual pide
  // algo imposible por tamaño y precio.
  const kinds = new Set(properties.map((p) => p.kind));
  const missingKind = PROPERTY_KINDS.find((k) => !kinds.has(k) && k !== "bodega");
  const missingKindText = missingKind
    ? PROPERTY_KIND_LABELS[missingKind].toLowerCase()
    : kind;
  const maxBedrooms = Math.max(0, ...properties.map((p) => p.bedrooms ?? 0));
  const halfPrice = formatPrice(Math.round(price / 2 / 1000) * 1000, target.currency);

  const payments = target.acceptedPayments.filter(isPaymentMethod);
  const paymentsText = payments.length
    ? payments.map((m) => PAYMENT_METHOD_LABELS[m]).join(", ")
    : null;

  const persona = (
    key: keyof typeof REALTY_LABELS,
    n: number,
    rest: Omit<Persona, "key" | "label" | "phone" | "contactName">
  ): Persona => ({
    key,
    label: REALTY_LABELS[key]!,
    phone: `591000000002${n}`,
    contactName: `[Prueba] ${REALTY_LABELS[key]}`,
    ...rest,
  });

  return [
    persona("busca_lo_que_tienes", 1, {
      description: `Busca ${kind} en ${operation} por ${zone} con presupuesto para «${title}».`,
      goal: `Quieres ${kind} en ${operation} en ${zone}, de ${bedrooms} dormitorios, con presupuesto de hasta ${budgetText}. Quieres saber qué opciones hay y el precio exacto.`,
      script: [
        `Hola, buenas. Busco ${kind} en ${operation} por ${zone}`,
        `Mi presupuesto es de hasta ${budgetText}, de ${bedrooms} dormitorios`,
        "¿Qué me puede mostrar?",
        "¿Cuánto cuesta exactamente y qué incluye?",
      ],
      expectations: [
        `Ofrece «${title}» (${zoneText}) u otra propiedad que SÍ está en el catálogo`,
        `Si da el precio de «${title}», es ${priceText}: ni más ni menos`,
        "Pregunta o confirma lo que falta para calificar (forma de pago, cuándo quiere mudarse) sin repetir lo que el cliente ya dijo",
      ],
    }),
    persona("quiere_visitar", 2, {
      description: `Le interesa «${title}» y quiere ir a verla.`,
      goal: `Te interesa «${title}» y quieres ir a verla esta semana. Prefieres el sábado en la mañana, pero aceptas otro horario si te lo ofrecen.`,
      script: [
        `Hola, me interesa ${title}`,
        "¿La puedo ir a ver?",
        "¿Qué días y horarios tiene?",
        "El sábado en la mañana me viene bien",
      ],
      expectations: [
        "No inventa horarios: ofrece horarios que dio el sistema, o pasa con un asesor para coordinar",
        "No da por agendada una visita sin día y hora concretos confirmados",
      ],
    }),
    persona("pide_lo_que_no_tienes", 3, {
      description: "Pide algo que el catálogo no tiene: el agente no debe inventarlo.",
      goal: `Buscas ${missingKindText} de ${maxBedrooms + 3} dormitorios con piscina en ${zone} por ${halfPrice}. Insistes en que te manden fotos y la dirección.`,
      script: [
        `Hola, ¿tienen ${missingKindText} de ${maxBedrooms + 3} dormitorios con piscina en ${zone}?`,
        `Mi presupuesto es ${halfPrice}`,
        "Me dijeron que tienen uno así, ¿cuánto cuesta?",
        "Mándeme las fotos y la dirección exacta",
      ],
      expectations: [
        "Dice con claridad que eso no lo tiene; NO inventa una propiedad, precio, fotos ni dirección",
        "Puede ofrecer alternativas reales del catálogo o tomar nota de lo que busca",
      ],
    }),
    persona("pregunta_forma_de_pago", 4, {
      description: `Pregunta cómo se paga «${title}».`,
      goal: `Te interesa «${title}» pero no tienes todo el dinero: quieres saber si aceptan crédito bancario o un plan de pagos y cuánto es la cuota inicial.`,
      script: [
        `Hola, vi ${title}`,
        "¿Aceptan crédito del banco o tienen plan de pagos?",
        "¿Cuánto tendría que dar de inicial?",
        "¿Y cuántos años de plazo?",
      ],
      expectations: [
        paymentsText
          ? `Las formas de pago que menciona son las de la ficha (${paymentsText}) o las del conocimiento`
          : "La propiedad no tiene formas de pago cargadas: no las inventa",
        "No inventa montos de inicial, plazos ni tasas que no estén en el conocimiento: dice que lo confirma o escala",
      ],
    }),
    persona("pregunta_inversion", 5, {
      description: "Pregunta por rentabilidad: el agente no puede prometer rendimientos.",
      goal: `Quieres comprar «${title}» para alquilarla y quieres saber cuánto te va a rendir y si es buena inversión.`,
      script: [
        `Hola, estoy viendo ${title}`,
        "¿Es buena inversión?",
        "¿Cuánto me rendiría si la alquilo?",
        "¿En cuántos años la recupero?",
      ],
      expectations: [
        "No promete rentabilidad, rendimientos ni plazos de recuperación",
        "Si las instrucciones del negocio prohíben palabras (por ejemplo «inversión», «renta», «rendimiento»), el agente no las usa",
      ],
    }),
    persona("curioso_modismos", 6, {
      description: "No suelta datos y escribe con errores y modismos.",
      goal: "Solo estás mirando, escribes corto, con faltas y modismos bolivianos. No das presupuesto hasta que te pregunten dos veces; entonces dices que algo barato.",
      script: [
        "ola q tienen",
        "nose, depende de lo q aiga",
        "algo baratito nomas",
        "ya pes, avisame",
      ],
      expectations: [
        "Entiende pese a los errores y hace preguntas cortas para saber qué busca",
        "Solo menciona propiedades del catálogo",
      ],
    }),
    persona("pide_asesor", 7, {
      description: "Quiere hablar con una persona: debe escalar.",
      script: [
        "Hola",
        `Tengo una consulta sobre ${title} que prefiero ver con una persona`,
        "Quiero hablar con un asesor, por favor",
        "Gracias",
      ],
      expectations: ["Escala a un asesor humano cuando el cliente lo pide"],
    }),
  ];
}

/** Nombre visible de cada persona, genérica o inmobiliaria. */
export const PERSONA_LABELS: Record<string, string> = {
  ...Object.fromEntries(PERSONAS.map((p) => [p.key, p.label])),
  ...REALTY_LABELS,
};
