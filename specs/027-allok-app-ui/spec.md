# Allok app UI — carril ligero

## Problema
La pantalla de inicio antepone un saludo y dos bloques de configuración a las métricas de operación. La navegación no expone el agente y la configuración del agente es una página larga. El aspecto necesita continuidad con la nueva landing de Allok.

## Alcance y aceptación
- Aplicar superficies neutras claras/oscuras y acento de marca respetando la personalización y el modo Vocero.
- Mostrar señales operativas antes de configuración y gráficos en Inicio. El checklist sigue disponible mediante un disclosure nativo accesible.
- Dar al propietario acceso directo al agente en Allok; conservar permisos y banderas existentes. Solo una entrada activa, incluso en Configuración/Equipo.
- Agrupar configuración del agente en Comportamiento, Conocimiento, Horarios y Conexiones. Cambiar de pestaña no descarta borradores.
- Mantener lista/hilo/detalles de conversaciones y controles de envío, sin modificar contratos ni enviar mensajes de prueba a clientes reales.
- Comprobar tipos, lint, tests, build y comportamiento visual en un entorno de prueba. Cualquier limitación se declara antes de merge.

## Decisiones
Cambios en rama de revisión. No desplegar producción ni cambiar planes, facturación, permisos o estado del agente. El entorno de prueba debe utilizar datos ficticios; no copiar conversaciones del negocio a artefactos.

## Verificación (2026-09-20)
- TypeScript y Next lint: sin errores.
- Build Next.js: completado.
- 500 pruebas existentes y 2 pruebas nuevas de selección de navegación: pasan.
- Navegador con los componentes reales y API aislada: búsqueda y estado sin resultados; apertura de hilo; tema claro/oscuro; pestañas y conservación del borrador; error visible al intentar guardar en la demo.
- Vista móvil a 390 × 844: inicio, menú, pestañas y horarios sin overflow horizontal.
- Pendiente antes de merge: E2E contra PostgreSQL y servicios de prueba con credenciales de staging. No se ejecutaron mutaciones ni pruebas sobre clientes reales.

## Vista de revisión reproducible
`node scripts/ui-preview/build.mjs /tmp/allok-ui-preview` genera la vista estática usando los componentes de esta rama. Servir la carpeta resultante con un servidor HTTP. Los datos son ficticios y todas las peticiones quedan dentro del adaptador de demostración; las escrituras se rechazan. No es un CRM conectado ni una sustitución del backend.
