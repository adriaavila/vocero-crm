# Guion E2E — Analítica (capa de agencia)

> Conducido por API (`fetch`, sin navegador) contra `pnpm dev` con mocks.
> Automatizado en `scripts/e2e-analitica.mjs`.

Pantalla propia del fork (`src/server/agencia/analitica.ts` + `/analytics`):
no toca `src/server/overview.ts`, que sigue siendo el tablero de puesta en
marcha. Solo la ve el propietario — muestra ingresos, igual que Agente y
Laboratorio.

## Conversión y dinero

1. Mover un lead a la etapa **ganada** con un monto (`PATCH
   /api/pipeline/leads/:id`, mismo camino que usa el tablero al arrastrar una
   tarjeta) → el "Ingreso ganado" de `/analytics` sube exactamente ese monto.
2. Mover un lead a la etapa **perdida** sin `lossReason` → 422
   (`loss_reason_required`): la puerta del dominio no se puede saltar desde
   analítica.
3. Con `lossReason`, el motivo aparece en "Motivos de pérdida".
4. El embudo cuenta leads DISTINTOS que entraron a cada etapa en la ventana —
   no cuántos hay HOY en cada una (eso ya lo hace `/overview`).

## Rango y comparativa

5. `?rango=7`, `?rango=30` y `?rango=90` responden 200 sin reventar aunque no
   haya datos suficientes en la ventana anterior para la comparativa (delta
   `null`, no una excepción).
6. Cada tarjeta con delta compara la ventana actual contra la inmediatamente
   anterior del mismo largo, no contra un total histórico.

## Agente IA y operación

7. Una conversación real (no de prueba) sin `handoffAt` cuenta como
   "resuelta sin humano".
8. `/analytics` en la pestaña Operación no truena con cero mensajes: cada
   bloque (primera respuesta, volumen por canal, horas pico) tiene su estado
   vacío en vez de una división por cero.

## Acceso

9. Sin sesión, `/analytics` termina en `/login` — nunca sirve datos de la
   organización a quien no tiene cuenta.
10. Un miembro del equipo que no es dueño rebota a `/overview` (mismo guard
    que `/agent` y `/lab`, `requireOwnerSession()` — cubierto por la
    infraestructura existente, no se repite aquí).

## Reglas duras que el código respeta (verificadas por lectura, no por script)

- `approximate = true` en `lead_stage_event` (fechas sembradas por una
  migración) entra a los totales de cierre pero **nunca** a "tiempo mediano
  por etapa": mezclarlas inventaría una duración que nadie observó.
- Un monto en otra moneda que la del negocio se cuenta aparte
  (`fueraDeMoneda`) y **nunca** se convierte ni se suma al total.
- Todas las consultas excluyen `is_test = true` — el Laboratorio no es
  operación real.
