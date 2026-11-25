/**
 * Calculadora de la sala de venta: el calendario de pagos de una casa con el
 * plan que aprobó la constructora, y cuánto de eso cubre lo que el comprador
 * hoy paga de alquiler.
 *
 * PURA a propósito (como `scoreProperty`): ni BD ni reloj. La cifra que ve el
 * comprador sale de aquí y de nada más — el agente de IA nunca estima una
 * cuota ni una fecha (regla de la constructora), solo manda el link.
 *
 * Todo se calcula en CENTAVOS ENTEROS y el último pago absorbe el redondeo:
 * la suma de los pagos es siempre el precio exacto, nunca $119.999,99.
 */

export type PasoPlan =
  | {
      tipo: "unico";
      etiqueta: string;
      /** Porción del precio, 0–100. */
      porcentaje: number;
      /** Meses después de la reserva (0 = el día de la reserva). */
      mes: number;
    }
  | {
      tipo: "mensual";
      etiqueta: string;
      porcentaje: number;
      /** Primer y último mes de la cuota, inclusive. */
      desdeMes: number;
      hastaMes: number;
    };

export type PlanPago = {
  nombre: string;
  /** Monto fijo de la reserva; se descuenta del primer paso del plan. */
  reserva: number;
  /** Los porcentajes suman 100. */
  pasos: PasoPlan[];
  /** Mes de la entrega, contado desde la reserva. */
  mesEntrega: number;
};

export type Pago = { mes: number; etiqueta: string; monto: number };

export type Calculo = {
  pagos: Pago[];
  total: number;
  /** La cuota mensual más alta del plan, si tiene cuotas mensuales. */
  cuotaMensual: number | null;
  /** Lo que pagaría de alquiler desde la reserva hasta la entrega. */
  alquilerHastaEntrega: number | null;
  /** Qué parte de la cuota mensual cubre el alquiler de hoy, 0–100. */
  coberturaCuota: number | null;
};

export class PlanInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanInvalido";
  }
}

const aCentavos = (monto: number) => Math.round(monto * 100);
const deCentavos = (centavos: number) => centavos / 100;

/** Los errores que hacen que un plan no se pueda usar, en palabras. */
export function validarPlan(plan: PlanPago): string[] {
  const errores: string[] = [];
  if (plan.pasos.length === 0) errores.push("El plan no tiene pasos");
  const suma = plan.pasos.reduce((s, p) => s + p.porcentaje, 0);
  if (Math.abs(suma - 100) > 0.01) {
    errores.push(`Los porcentajes suman ${suma} y deben sumar 100`);
  }
  if (plan.reserva < 0) errores.push("La reserva no puede ser negativa");
  if (plan.mesEntrega < 0) errores.push("El mes de entrega no puede ser negativo");
  for (const paso of plan.pasos) {
    if (paso.porcentaje <= 0) errores.push(`«${paso.etiqueta}» tiene un porcentaje vacío`);
    if (paso.tipo === "unico" && paso.mes < 0) {
      errores.push(`«${paso.etiqueta}» tiene un mes negativo`);
    }
    if (paso.tipo === "mensual" && (paso.desdeMes < 0 || paso.hastaMes < paso.desdeMes)) {
      errores.push(`«${paso.etiqueta}» tiene un rango de meses inválido`);
    }
  }
  return errores;
}

export function calcularCuotas(
  precio: number,
  plan: PlanPago,
  alquilerActual?: number | null
): Calculo {
  const errores = validarPlan(plan);
  if (errores.length > 0) throw new PlanInvalido(errores.join(". "));
  if (!(precio > 0)) throw new PlanInvalido("El precio debe ser mayor a cero");

  const precioC = aCentavos(precio);
  const reservaC = Math.min(aCentavos(plan.reserva), precioC);
  const pagos: { mes: number; etiqueta: string; centavos: number }[] = [];
  if (reservaC > 0) pagos.push({ mes: 0, etiqueta: "Reserva", centavos: reservaC });

  let porDescontar = reservaC;
  let mensualMaxC: number | null = null;

  for (const paso of plan.pasos) {
    let pasoC = Math.round((precioC * paso.porcentaje) / 100);
    // La reserva es parte del precio: se resta del primer paso que la cubra.
    const descuento = Math.min(porDescontar, pasoC);
    pasoC -= descuento;
    porDescontar -= descuento;
    if (pasoC <= 0) continue;

    if (paso.tipo === "unico") {
      pagos.push({ mes: paso.mes, etiqueta: paso.etiqueta, centavos: pasoC });
      continue;
    }
    const meses = paso.hastaMes - paso.desdeMes + 1;
    const base = Math.floor(pasoC / meses);
    const resto = pasoC - base * meses;
    for (let i = 0; i < meses; i++) {
      const centavos = base + (i === meses - 1 ? resto : 0);
      pagos.push({
        mes: paso.desdeMes + i,
        etiqueta: `${paso.etiqueta} ${i + 1} de ${meses}`,
        centavos,
      });
      mensualMaxC = Math.max(mensualMaxC ?? 0, centavos);
    }
  }

  // El redondeo por paso puede dejar centavos sueltos: van al último pago.
  pagos.sort((a, b) => a.mes - b.mes);
  const suma = pagos.reduce((s, p) => s + p.centavos, 0);
  const ultimo = pagos[pagos.length - 1];
  if (ultimo) ultimo.centavos += precioC - suma;

  const alquilerC =
    alquilerActual !== undefined && alquilerActual !== null && alquilerActual > 0
      ? aCentavos(alquilerActual)
      : null;

  return {
    pagos: pagos.map((p) => ({ mes: p.mes, etiqueta: p.etiqueta, monto: deCentavos(p.centavos) })),
    total: deCentavos(precioC),
    cuotaMensual: mensualMaxC === null ? null : deCentavos(mensualMaxC),
    alquilerHastaEntrega: alquilerC === null ? null : deCentavos(alquilerC * plan.mesEntrega),
    coberturaCuota:
      alquilerC === null || mensualMaxC === null || mensualMaxC === 0
        ? null
        : Math.min(100, Math.round((alquilerC / mensualMaxC) * 100)),
  };
}

/**
 * La frase de arriba de la calculadora. Habla del GASTO del comprador, nunca
 * de una ganancia: "renta", "inversión" o "rendimiento" están prohibidas en
 * el material de la constructora (ver `sala-palabras.ts`).
 */
export function fraseAlquiler(calculo: Calculo, moneda: string): string | null {
  const fmt = (n: number) => formatoMonto(n, moneda);
  if (calculo.coberturaCuota !== null && calculo.cuotaMensual !== null) {
    return calculo.coberturaCuota >= 100
      ? `Lo que hoy pagas de alquiler alcanza para tu cuota mensual de ${fmt(calculo.cuotaMensual)}.`
      : `Lo que hoy pagas de alquiler cubre el ${calculo.coberturaCuota} % de tu cuota mensual de ${fmt(calculo.cuotaMensual)}.`;
  }
  if (calculo.alquilerHastaEntrega !== null && calculo.alquilerHastaEntrega > 0) {
    return `Hasta la entrega pagarías ${fmt(calculo.alquilerHastaEntrega)} de alquiler. Esos meses pueden ser pagos de tu casa.`;
  }
  return null;
}

/** `US$ 120.000` / `Bs 1.234,50`: separadores de Bolivia. */
export function formatoMonto(monto: number, moneda: string): string {
  const simbolo = moneda === "BOB" ? "Bs" : moneda === "USD" ? "US$" : moneda;
  const entero = Number.isInteger(monto);
  const texto = monto.toLocaleString("es-BO", {
    minimumFractionDigits: entero ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${simbolo} ${texto}`;
}
