# Políticas y operación — primera implementación

Versión de contratación: 2026-10-v2. Las nuevas reservas guardan su política. Las anteriores conservan su porcentaje original. La migración agrega campos sin borrar datos.

## Incumplimientos

- Reclamos por inasistencia profesional, abandono, cancelación profesional, inasistencia del cliente, calidad, fuerza mayor y otros problemas.
- Inasistencia profesional: se puede reportar después de 15 minutos desde la hora de atención, sin contar preparación.
- Una reserva pagada sin entrega después de 24 horas de su término genera un caso de revisión una sola vez. No declara culpabilidad ni devuelve dinero sin revisión.
- Un caso pendiente, pendiente de ejecutar o apelado bloquea la liquidación.
- Administración puede suspender nuevas contrataciones con fundamento y levantar la suspensión. Las reservas existentes siguen accesibles. Acceso: Pagos y liquidaciones → Operaciones → Gestionar suspensión.
- No hay expulsión por una denuncia ni multas automáticas. Las sanciones requieren revisión humana.

## Cancelaciones

- Nuevas reservas: 100 % con al menos 48 horas de anticipación al inicio de la dedicación reservada; después, el porcentaje guardado al solicitar (inicialmente 80 %).
- Las reservas antiguas conservan su porcentaje original.
- Incumplimiento profesional confirmado: devolución del 100 %, aunque el formulario envíe un porcentaje inferior.
- Después de la entrega/conformidad o durante un reclamo el cliente debe gestionar la devolución con Skilly.
- Cancelar sin pago devuelve cero y no registra retención.
- El importe no devuelto queda pendiente de acuerdo: no se registra como comisión ganada ni se transfiere automáticamente. Falta decidir el reparto comercial y su liquidación.
- Administración registra una decisión pendiente en Incidencias, ejecuta la devolución desde la reserva y cierra el caso después. Una devolución total pendiente impide cerrar como cumplida.
- Un resultado incierto del proveedor queda bloqueado. Operaciones permite registrar referencia y evidencia de que se ejecutó o de que no se ejecutó. No hay reintento automático de devoluciones inciertas.

## Reclamos y entrega

- Historial de apertura, respuestas, decisiones, conformidad y apelación, con autor y fecha.
- Respuesta prevista en un día hábil y revisión en dos días hábiles. Se excluyen sábados y domingos; aún no se contemplan feriados.
- Registrar una decisión asigna el caso al administrador. Los casos vencidos generan avisos.
- Correcciones/reprogramaciones requieren conformidad de la organización posterior a la decisión antes del cierre.
- Solo se marca entregado después del término reservado, con una descripción de la prestación y evidencia. La descripción por sí sola no prueba la prestación.
- La confirmación de entrega es independiente de la evaluación.
- Después de tres días sin confirmación se avisa al cliente, profesional y correo administrativo configurado; no se libera por silencio.
- Reclamos hasta 30 días después de liquidar y una apelación dentro de siete días de resolver cada caso.
- La devolución parcial cierra la reserva; aún no hay liquidación proporcional por hitos. La reprogramación conserva el mecanismo administrativo anterior, sin doble aceptación de fecha.

## Mediación de servicios

- Un servicio observado/rechazado permite justificar la propuesta y solicitar contacto por correo o teléfono.
- Administración registra contactos, propuestas y cierres fundamentados. El profesional puede responder, aceptar, rechazar o retirar la mediación.
- Seguimiento en dos días hábiles y aviso de vencimiento al correo administrativo configurado.
- No se edita ni aprueba el borrador mientras existe una mediación abierta. Aceptar comprueba la versión revisada.
- Aceptar registra el acuerdo: no cambia el precio ni publica automáticamente. La edición y aprobación siguen el flujo habitual.
- Las llamadas y conversaciones externas las realiza Skilly; la plataforma conserva el registro.

## Pagos, transferencias y avisos

- La liquidación simulada se limita a pagos simulados fuera de producción.
- Pagos reales confirmados: preparar orden, realizar/verificar transferencia fuera de Skilly y registrar referencia única, monto exacto y comprobante adjunto de esa reserva.
- Una orden pendiente impide iniciar una devolución. Si aparece un reclamo, conciliar si ya se transfirió. Si no ocurrió, anular la orden con evidencia y auditoría.
- Skilly no inicia transferencias bancarias: su registro depende de verificación administrativa. No se validaron operaciones reales con las credenciales del usuario.
- Reclamar después de una transferencia no recupera fondos automáticamente del profesional. La devolución y recuperación requieren gestión externa y decidir quién aporta los fondos.
- Correos en cola: hasta cinco intentos, espera creciente y bloqueo de envío concurrente; reintento manual y listado de fallos en Operaciones.
- SMTP no garantiza entrega exactamente una vez: un corte después de aceptar un mensaje puede causar un duplicado al reintentar.
- El proceso público server/index.js, incluido en npm start, revisa casos y correos cada minuto. Debe mantenerse ejecutándose. Sin Gmail los mensajes quedan en bandeja local. Configurar ADMIN_NOTIFICATION_EMAIL para el equipo responsable.

## Validación y aplicación

Ejecutar npm run check y npm test. Las pruebas usan bases temporales y pasarelas controladas, sin cobros ni correos reales.

Para aplicar al entorno habitual: respaldar con npm run db:backup, reiniciar ambos procesos y recargar el navegador. No borrar la base. La revisión visual usa tests/preview.js y .local/preview.db, separados de server/skilly.db.

Accesos: reserva → Incidencias; administración → Incidencias; Mis servicios / Servicios y comisiones → Mediación; administración → Pagos y liquidaciones → Operaciones, devoluciones y avisos pendientes.

Pendientes de siguiente etapa: reparto y pago de retenciones, sanciones graduadas, feriados, salida formal del profesional, aceptación bilateral de reprogramaciones, recuperación de fondos transferidos e integración de transferencias bancarias automáticas.
