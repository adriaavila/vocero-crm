/**
 * "Estos 3 están listos, llámalos hoy": qué tan caliente está cada comprador
 * según lo que hizo en su sala. PURA (el reloj entra como argumento).
 *
 * El motivo va en palabras porque el dueño no maneja un CRM: lee una frase y
 * llama. Un puntaje sin motivo enseña a desconfiar de la lista.
 */
export type SenalSala = {
  aperturas: number;
  ultimaAperturaAt: Date | null;
  calculadoraAt: Date | null;
  visitaPedidaAt: Date | null;
};

export type Puntaje = { puntos: number; motivo: string | null };

const DIA = 24 * 60 * 60 * 1000;

export function puntuarSala(senal: SenalSala, ahora: Date): Puntaje {
  const reciente = (fecha: Date | null, dias: number) =>
    fecha !== null && ahora.getTime() - fecha.getTime() <= dias * DIA;

  const motivos: string[] = [];
  let puntos = 0;
  if (reciente(senal.visitaPedidaAt, 7)) {
    puntos += 100;
    motivos.push("pidió visitar");
  }
  if (reciente(senal.calculadoraAt, 7)) {
    puntos += 30;
    motivos.push("usó la calculadora");
  }
  if (senal.aperturas >= 2 && reciente(senal.ultimaAperturaAt, 7)) {
    puntos += 10 * Math.min(senal.aperturas, 5);
    motivos.push(`abrió su sala ${senal.aperturas} veces`);
  } else if (senal.aperturas === 1 && reciente(senal.ultimaAperturaAt, 2)) {
    puntos += 5;
    motivos.push("abrió su sala");
  }

  if (motivos.length === 0) return { puntos: 0, motivo: null };
  const motivo =
    motivos.length === 1
      ? motivos[0]!
      : `${motivos.slice(0, -1).join(", ")} y ${motivos[motivos.length - 1]}`;
  return { puntos, motivo: motivo.charAt(0).toUpperCase() + motivo.slice(1) };
}

/** Los `n` con más señal, sin los que no hicieron nada. */
export function llamarHoy<T extends SenalSala>(
  salas: T[],
  ahora: Date,
  n = 3
): (T & Puntaje)[] {
  return salas
    .map((sala) => ({ ...sala, ...puntuarSala(sala, ahora) }))
    .filter((sala) => sala.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, n);
}
