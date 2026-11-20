/**
 * @file Última capa de funciones de negocio en el navegador. Reemplaza controles
 * básicos de workspace.js para reclamos, entregas y devoluciones, y añade mediación y registro
 * de transferencias. Todas las acciones se validan nuevamente en la API.
 */

// Controles de políticas compartidos por las aplicaciones pública y administrativa.
const caseLabels={inasistencia_profesional:'El profesional no asistió',abandono:'Sin respuesta / abandono',cancelacion_profesional:'Necesito cancelar como profesional',inasistencia_cliente:'El cliente no asistió',calidad:'Calidad o entrega incompleta',fuerza_mayor:'Fuerza mayor',otro:'Otro problema'};
/**
 * Convierte un mapa valor/etiqueta en opciones HTML escapadas para los selectores de políticas.
 *
 * @param {Object<string, string>} values - Mapa de valores y etiquetas para un selector.
 * @returns {string} Opciones HTML con valores y etiquetas escapados.
 */
function options(values){return Object.entries(values).map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ ([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');}
/**
 * Renderiza tipo, fecha y texto escapado de cada evento de un reclamo o mediación; admite una
 * lista ausente.
 *
 * @param {Object[]|null|undefined} rows - Eventos con kind, created_at y body; puede estar ausente.
 * @returns {string} HTML de los eventos o texto vacío.
 */
function caseEvents(rows){return (rows||[]).map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ e=>`<p><b>${esc(e.kind)}</b> · ${prettyDate(e.created_at)}<br>${esc(e.body)}</p>`).join('');}
/**
 * Carga los reclamos de una reserva y muestra historia, evidencia, plazos y acciones permitidas
 * al rol. Ofrece apertura solo si no existe otro pendiente; las condiciones finales se validan
 * en la API.
 *
 * @param {string} id - ID de la reserva.
 * @returns {Promise<void>} Finaliza la consulta y actualización de interfaz sin devolver datos.
 */
openIncident=async id=>{try{const rows=await Api.list('bookings/'+id+'/incidents');const pro=SESSION.role==='profesional';const choices=Object.fromEntries(Object.entries(caseLabels).filter(/* Conserva los elementos según la condición pro?k!=='inasistencia_profesional':!['inasistencia_cliente','cancelacion_profesional'].includes(k). Se evalúan los datos ya cargados. */ ([k])=>pro?k!=='inasistencia_profesional':!['inasistencia_cliente','cancelacion_profesional'].includes(k)));
  modal('Reclamos y soluciones',`<p>Los reclamos pendientes bloquean la liquidación. Respuesta prevista: 1 día hábil; revisión de Skilly: 2 días hábiles. Puedes adjuntar evidencia en Documentos.</p>`+rows.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ i=>`<article class="dashCard"><b>${esc(caseLabels[i.category]||i.category)} · ${esc(i.status)}</b><p>${esc(i.body)}</p><p>${esc(i.evidence||'')}</p><p>Respuesta: ${prettyDate(i.response_due)} · Resolución: ${prettyDate(i.resolution_due)}</p><p>${esc(i.resolution||'')}</p>${caseEvents(i.events)}<label>Respuesta / evidencia<textarea id="reply-${i.id}"></textarea></label>${i.status!=='resuelta'?action('Agregar respuesta',`caseReply('${i.id}','reply','${id}')`):i.appeals<1?action('Apelar resolución (7 días)',`caseReply('${i.id}','appeal','${id}')`):''}${i.status==='pendiente_accion'&&['organizacion','invitado'].includes(SESSION.role)?action('Confirmar solución recibida',`caseReply('${i.id}','accept','${id}')`):''}</article>`).join('')+
  (rows.some(/* Comprueba si existe algún elemento según la condición i.status!=='resuelta'. Se evalúan los datos ya cargados. */ i=>i.status!=='resuelta')?'':`<label>Motivo<select id="caseCategory">${options(choices)}</select></label><label>Qué ocurrió<textarea id="incidentBody"></textarea></label><label>Evidencia / intentos de contacto<textarea id="caseEvidence"></textarea></label><label>Solución solicitada<select id="caseRemedy">${options({revision:'Revisión de Skilly',reembolso:'Reembolso',reprogramacion:'Reprogramación',correccion:'Corrección'})}</select></label>${action('Abrir reclamo',`submitIncident('${id}')`,'primary')}`));
}catch(e){toast(e.message);}};
/**
 * Envía categoría, descripción, evidencia y solución solicitada para abrir un reclamo y vuelve a
 * cargar su historial.
 *
 * @param {string} id - ID de la reserva.
 * @returns {Promise<void>} Finaliza la acción; perform muestra errores mediante toast.
 */
submitIncident=id=>perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('bookings/'+id+'/incidents',{body:$('incidentBody').value,category:$('caseCategory').value,evidence:$('caseEvidence').value,remedy:$('caseRemedy').value});await openIncident(id);});
/**
 * Envía el fundamento del formulario a reply, appeal o accept según la acción seleccionada.
 * Recarga el caso para mostrar la respuesta confirmada por el servidor.
 *
 * @param {string} id - ID de la incidencia.
 * @param {string} kind - Acción reply, appeal o accept.
 * @param {string} booking - ID de reserva cuyo historial se recarga.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function caseReply(id,kind,booking){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('incidents/'+id+'/'+kind,{body:$('reply-'+id).value});await openIncident(booking);});}
/**
 * Presenta los casos administrativos con resultado, fundamento y acciones separadas para decidir
 * o cerrar. Permite abrir la reserva para ejecutar una devolución pendiente.
 *
 * @param {HTMLElement} el - Contenedor de la sección.
 * @returns {Promise<void>} Finaliza la consulta y actualización de interfaz sin devolver datos.
 */
renderIncidents=async el=>{try{const rows=await Api.adminGet('incidents');el.innerHTML='<p>Primero registra una decisión pendiente; ejecuta la devolución o verifica la solución antes de cerrar el caso.</p>'+rows.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ i=>`<article class="dashCard"><h3>${esc(i.service)}</h3><p>${esc(i.org_name)} · ${esc(caseLabels[i.category]||i.category)} · ${esc(i.status)}</p><p>${esc(i.body)}</p><p>Responsable: ${esc(i.assigned_to||'Sin asignar')} · Plazo: ${prettyDate(i.resolution_due)}</p>${i.status!=='resuelta'?`<label>Resultado<select id="outcome-${i.id}">${options({sin_compensacion:'Sin compensación (fundamentar)',incumplimiento_profesional:'Incumplimiento profesional: devolución total',reembolso_total:'Devolución total',reembolso_parcial:'Devolución parcial acordada',correccion:'Corrección',reprogramacion:'Reprogramación'})}</select></label><label>Decisión, evidencia y acciones<textarea id="resolution-${i.id}">${esc(i.resolution||'')}</textarea></label>${action('Registrar decisión pendiente',`decideCase('${i.id}',false)`)}${action('Cerrar con acciones cumplidas',`decideCase('${i.id}',true)`,'primary')}`:`<p>${esc(i.resolution)}</p>`}${action('Ver respuestas y evidencia',`openIncident('${i.booking_id}')`)}${action('Ver reserva / devolución',`showBooking('${i.booking_id}')`)}</article>`).join('');for(const i of rows)if($('outcome-'+i.id)&&i.outcome)$('outcome-'+i.id).value=i.outcome;}catch(e){toast(e.message);}};
/**
 * Guarda resultado, resolución y bandera close en el reclamo. El servidor exige devolución o
 * conformidad previa cuando el cierre lo requiere.
 *
 * @param {string} id - ID de la incidencia.
 * @param {boolean} close - Indica si se solicita cerrar el caso.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function decideCase(id,close){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('admin/incidents/'+id,{outcome:$('outcome-'+id).value,resolution:$('resolution-'+id).value,close},'PATCH');await renderIncidents($('adminContent'));});}
/**
 * Abre el formulario de evidencia de la prestación. La actualización de estado se envía mediante
 * saveDelivery y requiere que termine el intervalo reservado.
 *
 * @param {string} id - ID de la reserva.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
markDelivered=id=>modal('Registrar entrega',`<p>Describe la prestación realizada y adjunta sus documentos desde la reserva. La dedicación reservada debe haber terminado.</p><label>Evidencia de entrega<textarea id="deliveryEvidence"></textarea></label>${action('Marcar entregado',`saveDelivery('${id}')`,'primary')}`);
/**
 * Envía estado entregado junto con la descripción de evidencia, cierra el modal y actualiza los
 * datos si la API lo acepta.
 *
 * @param {string} id - ID de la reserva.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function saveDelivery(id){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('bookings/'+id,{status:'entregado',evidence:$('deliveryEvidence').value},'PATCH');closeM('workspaceModal');await refreshAll();});}
/**
 * Confirma la recepción sin exigir evaluación y refresca la reserva. La liquidación sigue
 * requiriendo revisión administrativa y ausencia de casos pendientes.
 *
 * @param {string} id - ID de la reserva.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function confirmDelivery(id){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('bookings/'+id+'/confirm',{});closeM('workspaceModal');await refreshAll();toast('Entrega confirmada. La evaluación es opcional.');});}
/**
 * Consulta la devolución voluntaria vigente y presenta el motivo. Para administración agrega un
 * porcentaje opcional; un incumplimiento confirmado exige el 100% en el servidor.
 *
 * @param {string} id - ID de reserva.
 * @param {boolean} [admin=false] - Habilita el campo administrativo de porcentaje.
 * @returns {Promise<void>} Finaliza la consulta y actualización de interfaz sin devolver datos.
 */
openCancelModal=async(id,admin=false)=>{try{const b=BOOKINGS.find(/* Busca el primer elemento según la condición x.id===id. Se evalúan los datos ya cargados. */ x=>x.id===id),q=await Api.list('bookings/'+id+'/cancellation-quote');$('cancelBookingBox').innerHTML=`<button class="close" onclick="closeM('cancelBooking')">×</button><h2>Cancelación / devolución</h2><p>${esc(b.service)}</p><p>Cancelación voluntaria ahora: ${q.percent}% · ${fmtMoney(q.amount)}. Si el profesional incumplió, abre un reclamo para solicitar el 100%.</p>${admin?'<label>Porcentaje para devolución administrativa o parcial acordada<input id="refundOverride" type="number" min="0" max="100" placeholder="Porcentaje según política"></label><p>Un reclamo con devolución total aprobada siempre aplica 100%.</p>':''}<label>Motivo<textarea id="cancelReason"></textarea></label>${action('Confirmar cancelación',`confirmCancelBooking('${id}',${admin})`,'danger')}`;openM('cancelBooking');}catch(e){toast(e.message);}};
/**
 * Envía motivo y, si se completó en administración, porcentaje de devolución. Cierra los modales
 * y recarga los importes confirmados; una respuesta incierta permanece a cargo de conciliación.
 *
 * @param {string} id - ID de reserva.
 * @param {boolean} admin - Permite incluir el porcentaje si fue completado.
 * @returns {Promise<void>} Finaliza la acción; perform muestra errores mediante toast.
 */
confirmCancelBooking=(id,admin)=>perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  const body={reason:$('cancelReason').value};if(admin&&$('refundOverride').value!=='')body.refundPercent=Number($('refundOverride').value);const r=await request('bookings/'+id+'/cancel',body);closeM('cancelBooking');closeM('workspaceModal');await refreshAll();toast('Devolución registrada: '+fmtMoney(r.refundAmount));});
const renderServicesBeforePolicies=renderMyServices;
/**
 * Extiende la vista de servicios propia con accesos a observaciones y mediación, conservando el
 * renderizador guardado antes de cargar este módulo.
 *
 * @param {HTMLElement} el - Contenedor de la sección.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
renderMyServices=el=>{renderServicesBeforePolicies(el);el.insertAdjacentHTML('beforeend','<h3>Observaciones y mediación</h3>'+SERVICES.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ s=>`<div class="dashCard"><b>${esc(s.title)}</b>${action('Ver revisión / solicitar conversación',`serviceMediation('${s.id}')`)}</div>`).join(''));};
const adminServicesBeforePolicies=renderAdminServices;
/**
 * Extiende la revisión administrativa de servicios con accesos a las mediaciones y al registro
 * de contactos.
 *
 * @param {HTMLElement} el - Contenedor de la sección.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
renderAdminServices=el=>{adminServicesBeforePolicies(el);el.insertAdjacentHTML('beforeend',SERVICES.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ s=>`<div class="dashCard"><b>${esc(s.title)}</b>${action('Mediaciones y contactos',`serviceMediation('${s.id}')`)}</div>`).join(''));};
/**
 * Consulta historial y eventos de negociación y presenta acciones de Skilly o del profesional.
 * Aceptar un acuerdo registra consentimiento; editar y publicar el servicio siguen siendo
 * operaciones separadas.
 *
 * @param {string} id - ID del servicio.
 * @returns {Promise<void>} Finaliza la consulta y actualización de interfaz sin devolver datos.
 */
async function serviceMediation(id){try{const rows=await Api.list('services/'+id+'/appeals'),admin=SESSION.role==='admin';modal('Revisión y mediación del servicio',`<p>El precio y alcance no cambian por aceptar un comentario. Todo cambio se envía a revisión. Registra por escrito los acuerdos de llamadas o correos.</p>`+rows.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ a=>`<article class="dashCard"><b>${esc(a.status)}</b><p>${esc(a.body)}</p><p>Contacto: ${esc(a.contact)} · Plazo: ${prettyDate(a.due_at)}</p><p>${esc(a.resolution||'')}</p>${caseEvents(a.events)}${['abierta','propuesta'].includes(a.status)?`<label>Fundamento, propuesta o resultado de contacto<textarea id="appealBody-${a.id}"></textarea></label>${(admin?[['contacto','Registrar contacto'],['propuesta','Enviar propuesta concreta'],['cierre','Cerrar sin acuerdo']]:[['respuesta','Responder'],['aceptar','Aceptar propuesta'],['rechazar','No estoy de acuerdo'],['retirar','Retirar mediación']]).map(/* Transforma cada elemento con action(l,`mediationEvent('${a.id}','${k}','${id}')`) para construir la colección utilizada por esta operación. */ ([k,l])=>action(l,`mediationEvent('${a.id}','${k}','${id}')`)).join('')}`:''}</article>`).join('')+(!admin&&!rows.some(/* Comprueba si existe algún elemento según la condición ['abierta','propuesta'].includes(a.status). Se evalúan los datos ya cargados. */ a=>['abierta','propuesta'].includes(a.status))?`<label>Justificación / desacuerdo<textarea id="mediationBody"></textarea></label><label>Correo o teléfono para contacto<input id="mediationContact" placeholder="Correo o teléfono y horario preferido"></label>${action('Solicitar mediación',`createMediation('${id}')`,'primary')}`:''));}catch(e){toast(e.message);}}
/**
 * Envía la justificación del desacuerdo y medio de contacto y recarga la mediación del servicio.
 *
 * @param {string} id - ID del servicio.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function createMediation(id){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('services/'+id+'/appeals',{body:$('mediationBody').value,contact:$('mediationContact').value});await serviceMediation(id);});}
/**
 * Registra contacto, propuesta, respuesta, aceptación, rechazo o retiro con su fundamento. La
 * API controla qué acciones admite cada rol y estado.
 *
 * @param {string} id - ID de mediación.
 * @param {string} kind - Tipo de evento seleccionado según el rol.
 * @param {string} service - ID del servicio cuyo historial se recarga.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function mediationEvent(id,kind,service){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('service-appeals/'+id+'/events',{kind,body:$('appealBody-'+id).value});await serviceMediation(service);});}
/**
 * Crea una orden de transferencia externa para una reserva y abre operaciones. No envía dinero
 * al banco; la API exige pago no simulado y entrega confirmada.
 *
 * @param {string} id - ID de la reserva.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function preparePayout(id){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  const r=await request('admin/bookings/'+id+'/payout',{});toast(r.message,8000);await showOperations();});}
/**
 * Muestra devoluciones inciertas, transferencias, correos pendientes y mediaciones para gestión
 * administrativa. Cada confirmación exige la evidencia correspondiente en el servidor.
 *
 * @returns {Promise<void>} Finaliza la consulta y actualización de interfaz sin devolver datos.
 */
async function showOperations(){try{const r=await Api.adminGet('operations');modal('Operaciones y seguimiento',`<p>Las transferencias se realizan fuera de Skilly. Confirma únicamente operaciones verificadas con comprobante. Las retenciones de cancelación quedan pendientes de acuerdo y no se liquidan automáticamente.</p>${action('Gestionar suspensión de nuevas contrataciones','suspensionForm()')}<h3>Devoluciones inciertas</h3>`+r.refunds.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ o=>`<article class="dashCard"><b>${esc(o.booking_id)} · ${fmtMoney(o.amount)}</b><label>Referencia proveedor<input id="ref-${o.id}"></label><label>Evidencia verificada<textarea id="evidence-${o.id}"></textarea></label>${action('Confirmar devolución ejecutada',`reconcileRefund('${o.id}','confirmado')`)}${action('Confirmar que no se ejecutó',`reconcileRefund('${o.id}','no_ejecutado')`)}</article>`).join('')+'<h3>Transferencias externas</h3>'+r.payouts.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ p=>`<article class="dashCard"><b>${esc(p.booking_id)} · ${fmtMoney(p.amount)} · ${esc(p.status)}</b>${p.status==='pendiente_transferencia'?`${action('Confirmar con comprobante',`payoutForm('${p.id}','${p.booking_id}',${p.amount})`)}<label>Si no se transfirió: evidencia bancaria<textarea id="void-${p.id}"></textarea></label>${action('Anular orden no ejecutada',`voidPayout('${p.id}')`)}`:`<p>${esc(p.reference||'')}</p>`}</article>`).join('')+'<h3>Correos pendientes</h3>'+r.emails.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ e=>`<article class="dashCard"><b>${esc(e.subject)}</b><p>${esc(e.recipient)} · intentos: ${e.attempts} · ${esc(e.last_error||'En espera de SMTP')}</p>${action('Reintentar',`retryEmail(${e.id})`)}</article>`).join('')+'<h3>Mediaciones pendientes</h3>'+r.appeals.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ a=>`<p>${esc(a.id)} · ${prettyDate(a.due_at)} ${action('Abrir',`serviceMediation('${a.service_id}')`)}</p>`).join(''));}catch(e){toast(e.message);}}
/**
 * Envía referencia y evidencia del resultado verificado externamente: devolución confirmada o no
 * ejecutada. Actualiza el panel sin repetir la llamada al proveedor.
 *
 * @param {string} id - ID de la devolución en revisión.
 * @param {string} result - Resultado confirmado o no_ejecutado.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function reconcileRefund(id,result){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('admin/refunds/'+id+'/reconcile',{result,reference:$('ref-'+id).value,evidence:$('evidence-'+id).value});await showOperations();});}
/**
 * Registra referencia bancaria, importe y adjunto de una transferencia ya realizada fuera de
 * Skilly. Refresca datos después de que el servidor comprueba reserva, monto y ausencia de
 * conflictos.
 *
 * @param {string} id - ID de la orden de transferencia.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function confirmPayout(id){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('admin/payouts/'+id+'/confirm',{reference:$('ref-'+id).value,amount:Number($('amount-'+id).value),evidenceId:$('doc-'+id).value});await refreshAll();await showOperations();});}
/**
 * Solicita anular una orden pendiente usando evidencia de que no hubo transferencia. No revierte
 * un movimiento bancario ejecutado.
 *
 * @param {string} id - ID de la orden de transferencia.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function voidPayout(id){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('admin/payouts/'+id+'/void',{evidence:$('void-'+id).value});await showOperations();});}
/**
 * Rehabilita los intentos de un correo pendiente y actualiza operaciones. El trabajador
 * periódico hará el envío; reenviar no renueva tokens de acceso vencidos.
 *
 * @param {number|string} id - ID de outbox recibido desde el botón o la API.
 * @returns {void} Inicia el reintento y la recarga de operaciones; perform muestra los errores.
 */
function retryEmail(id){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('admin/outbox/'+id+'/retry',{});await showOperations();});}

/**
 * Carga adjuntos de la reserva y abre el formulario para referencia, importe y comprobante
 * bancario. No selecciona automáticamente evidencia de otra reserva.
 *
 * @param {string} id - ID de la orden de transferencia.
 * @param {string} booking - ID de reserva para listar adjuntos.
 * @param {number} amount - Importe CLP previsto que se muestra como referencia.
 * @returns {Promise<void>} Finaliza la consulta y actualización de interfaz sin devolver datos.
 */
async function payoutForm(id,booking,amount){try{const docs=await Api.list('bookings/'+booking+'/attachments');modal('Confirmar transferencia externa',`<p>Monto previsto: ${fmtMoney(amount)}. Confirma solo después de verificar la operación bancaria.</p><label>Referencia bancaria<input id="ref-${id}"></label><label>Monto transferido<input id="amount-${id}" type="number"></label><label>Comprobante adjunto<select id="doc-${id}"><option value="">Seleccionar documento</option>${docs.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>${action('Adjuntar comprobante',`openDocuments('${booking}')`)}${action('Confirmar transferencia realizada',`confirmPayout('${id}')`,'primary')}`);}catch(e){toast(e.message);}}

/**
 * Abre la selección de profesional y fundamento para suspender o habilitar nuevas
 * contrataciones. La medida no elimina historial ni acceso a casos existentes.
 *
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function suspensionForm(){modal('Nuevas contrataciones',`<p>La suspensión no elimina el historial ni los reclamos. Fundamenta la decisión y las condiciones de revisión.</p><label>Profesional<select id="suspendProfessional">${PROFESSIONALS.map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ p=>`<option value="${p.id}">${esc(p.name)} · ${p.bookingSuspended?'Suspendido':'Habilitado'}</option>`).join('')}</select></label><label>Motivo y condiciones de revisión<textarea id="suspendReason"></textarea></label>${action('Suspender','setSuspension(true)','danger')}${action('Habilitar nuevamente','setSuspension(false)')}`);}
/**
 * Envía la bandera de suspensión y su motivo a administración y refresca perfiles y operaciones.
 *
 * @param {boolean} suspended - Estado solicitado de suspensión profesional.
 * @returns {void} Actualiza la interfaz o inicia la acción sin devolver datos.
 */
function setSuspension(suspended){perform(async()=>{
  // Ejecuta la acción del formulario y sus actualizaciones de pantalla; perform captura los errores para mostrarlos con toast.
  await request('admin/professionals/'+$('suspendProfessional').value+'/suspension',{suspended,reason:$('suspendReason').value});await refreshAll();await showOperations();});}
