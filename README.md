# Skilly · Aplicaciones pública y administrativa

Ejecuta `npm run check` y `npm test` para validar el código. `npm run test:evidence` guarda resultados locales en `.local/test-results/`. `npm run db:docs` exporta los scripts SQL a `database/schema-exports/` y la documentación generada a `.local/schema-docs/`. Los informes y las evidencias no se versionan.

> Actualización: consultar [Políticas y operación](POLITICAS_IMPLEMENTADAS.md) para reclamos, cancelaciones, mediación y transferencias externas. Esta actualización sustituye las indicaciones anteriores sobre liquidación exclusivamente simulada y ausencia de reintentos de correo.

La actualización conserva el diseño y las funciones anteriores de validación, reservas, chat, evaluaciones privadas, pagos y seguimiento de organizaciones. Agrega cuentas protegidas, varios servicios por profesional, comisiones configurables y espacios por rol.

## Arquitectura

| Aplicación | Dirección local | Usuarios | Entrada |
| --- | --- | --- | --- |
| Skilly | http://localhost:3000 | Visitantes, organizaciones y profesionales | server/index.js + public/index.html |
| Administración | http://localhost:3001 | Equipo Skilly con cuentas individuales | server/admin.js + admin/index.html |

Son dos aplicaciones Express con procesos HTTP, entradas HTML y sesiones independientes. Comparten módulos de negocio, estilos y una base PostgreSQL. El profesional utiliza el sitio principal, pero ve exclusivamente su panel y no tiene navegación de catálogo ni acciones de contratación.

Pueden utilizar skilly.cl y admin.skilly.cl mediante un proxy HTTPS. Ambos procesos usan la misma conexión DATABASE_URL; la base puede alojarse separadamente. Consulta [DESPLIEGUE.md](DESPLIEGUE.md).

## 1. Preparar Windows

Abre el proyecto en VS Code y una terminal PowerShell:

~~~powershell
Set-Location 'C:\ruta\a\skilly'
node --version
npm --version
~~~

Probado con **Node.js 22.23.3**. Sustituye la ruta del ejemplo por tu carpeta real y comprueba que Node.js esté disponible en la terminal.

Si PowerShell bloquea npm.ps1, utiliza **npm.cmd** en los comandos siguientes. No necesitas cambiar la política de ejecución del sistema.

## 2. Instalar y configurar

~~~powershell
npm ci
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
~~~

Se instalan las versiones del archivo package-lock.json. Si ya existe .env, consérvalo y agrega las variables nuevas de .env.example.

Configuración local mínima:

~~~dotenv
PORT=3000
ADMIN_PORT=3001
BASE_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001
HOST=127.0.0.1
NODE_ENV=development
COOKIE_SECURE=false
TRUST_PROXY=false
DATABASE_URL=postgresql://skilly_app:CAMBIAR@127.0.0.1:5432/skilly
TEST_DATABASE_URL=postgresql://skilly_app:CAMBIAR@127.0.0.1:5432/skilly_test
WEBPAY_ENV=integration
PAYPAL_ENV=sandbox
~~~

Instala PostgreSQL 18 y configura un usuario exclusivo y las bases `skilly` y `skilly_test`. Sustituye CAMBIAR por la contraseña local; no publiques `.env`. Ejecuta `npm run db:migrate`. No se crean cuentas ni perfiles demo automáticamente. Consulta [la guía PostgreSQL](docs/POSTGRESQL.md).

El pago simulado permite probar todo el recorrido sin correo ni pasarelas externas.

## 3. Respaldar y migrar

`npm run db:backup` genera un respaldo PostgreSQL `.dump` en `.local/backups/`. Requiere `pg_dump` de la misma versión principal o posterior; `PG_BIN` permite indicar su carpeta.

La migración local del 15-11-2026 trasladó 169 registros de 20 tablas y verificó su contenido. El archivo SQLite original y su respaldo se conservan, pero la aplicación ya no los utiliza. La importación a otra instalación solo admite un destino vacío: consulta [el procedimiento](docs/POSTGRESQL.md). Las cuentas conservan sus contraseñas existentes.

## 4. Crear el primer administrador

~~~powershell
npm run admin:create
~~~

Escribe correo y nombre. La terminal mostrará una contraseña inicial aleatoria: guárdala. No existe una clave compartida y ADMIN_PASSCODE ya no se utiliza. Si el correo ya tiene cuenta, el comando no la reemplaza.

Los siguientes administradores se invitan desde **Administradores → Invitar administrador**. Todos tienen los mismos permisos y cada uno establece su contraseña mediante un enlace.

## 5. Levantar las aplicaciones

~~~powershell
npm start
~~~

Abre:

- **Sitio público y panel profesional:** http://localhost:3000
- **Administración:** http://localhost:3001

Mantén la terminal abierta. **Ctrl+C** detiene ambos procesos. También puedes iniciarlos por separado, en dos terminales:

~~~powershell
npm run start:public
~~~

~~~powershell
npm run start:admin
~~~

npm run dev inicia las mismas dos aplicaciones; no incorpora recarga automática del servidor. Tras modificar el servidor o .env, detén y vuelve a iniciar. Para cambios de HTML, CSS o JavaScript del navegador, recarga la página.

## 6. Primera prueba completa

1. Ingresa en administración con tu cuenta inicial.
2. En el sitio público, crea un profesional con otro correo y completa su primer servicio, LinkedIn y antecedentes.
3. En administración, aprueba primero el perfil en **Validaciones** y después su servicio en **Servicios y comisiones**. Son revisiones independientes.
4. En el panel profesional, configura **Disponibilidad** y revisa **Calendario**.
5. Cierra la sesión profesional y crea una organización con otro correo. Solicita un horario futuro desde el catálogo.
6. Ingresa como profesional y acepta en **Solicitudes y reservas**.
7. Regresa a la organización: **Reservas → Aceptar condiciones y pagar → Pago simulado**. Se muestran nombre y LinkedIn; se habilitan chat y documentos.
8. El profesional marca entregado; la organización confirma la entrega y escribe su evaluación privada.
9. Administración resuelve cualquier incidencia abierta y autoriza la **liquidación simulada**.

Usa ventanas o perfiles de navegador distintos para probar varios usuarios a la vez. La sesión administrativa es independiente de la pública, incluso en un mismo navegador.

La [GUÍA DE USO](GUIA_DE_USO.md) explica las pestañas, invitados, comisiones, calendario y recuperación de perfiles.

## 7. Correos y enlaces de pruebas

Sin Gmail, los mensajes se guardan en la bandeja local. En administración abre **Configuración → Correos de prueba**, copia el enlace del destinatario de prueba y ábrelo. Allí aparecen verificaciones, invitaciones, recuperación de contraseña y acceso de invitados.

Para enviar correo, completa .env y reinicia:

~~~dotenv
GMAIL_USER=correo-emisor
GMAIL_APP_PASSWORD=contraseña-de-aplicación
ADMIN_NOTIFICATION_EMAIL=correo-del-equipo
~~~

La bandeja de prueba se desactiva con NODE_ENV=production. Los fallos quedan registrados y la cola aplica hasta cinco intentos con espera creciente. Operaciones permite revisar y reintentar los mensajes pendientes. Un enlace vencido requiere una nueva solicitud; reenviar un correo no renueva su token. No compartas .env ni la base de datos.

## 8. Pasarelas de pruebas

| Método | Configuración | Alcance |
| --- | --- | --- |
| Simulado | NODE_ENV distinto de production | Sin operaciones bancarias |
| Webpay Plus | WEBPAY_ENV=integration | Credenciales de integración del SDK; requiere conexión al proveedor |
| PayPal | PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET | Tu aplicación y comprador de prueba de PayPal |

Webpay valida estado, código de respuesta, monto y orden al regresar. Consulta los datos de prueba vigentes en la [documentación oficial de Webpay Plus](https://transbankdevelopers.com/documentacion/webpay-plus).

PayPal valida orden, reserva, monto y moneda. Configura tus credenciales en su [panel de aplicaciones sandbox](https://developer.paypal.com/dashboard/applications/sandbox). PAYPAL_CLP_USD_RATE=950 es una tasa de ejemplo del proyecto para convertir a USD, no una cotización actualizada. La comisión y los reportes se calculan sobre el precio original en CLP.

Un retorno repetido no registra otro pago. Un cobro confirmado después del plazo queda en conciliación sin reactivar el horario. Administración permite consultar el estado y reembolsar cobros tardíos confirmados. Un reembolso incierto queda bloqueado para evitar repetirlo y requiere conciliación externa.

**Validación realizada:** flujo simulado y pruebas con respuestas controladas de Webpay/PayPal. No se completó una compra contra los servicios externos de sandbox con tus credenciales. Esa comprobación debe hacerse antes de usar la integración con clientes.

La liquidación al profesional registra una operación simulada, sin transferencia bancaria ni reparto automático. Los comprobantes descargables no son tributarios; las boletas/facturas se emiten fuera de Skilly y se adjuntan.

## 9. Verificaciones

~~~powershell
npm run check
npm test
npm audit
~~~

Las pruebas usan esquemas temporales en la base PostgreSQL indicada por TEST_DATABASE_URL, cuyo nombre debe terminar en _test. No modifican la base de trabajo. Cubren permisos, identidad, moderación, comisiones, agenda, invitados, documentos, incidencias, recuperación, pagos repetidos/tardíos, migración y respaldo.

## Problemas habituales

- **Puerto ocupado:** cambia PORT o ADMIN_PORT y también BASE_URL o ADMIN_URL. No alternes entre localhost y 127.0.0.1 en una misma sesión.
- **Servicio ausente:** necesita perfil validado y publicación aprobada; un borrador no sustituye automáticamente la versión anterior.
- **Sin horarios:** revisa días, horas de inicio, jornada, bloqueos, capacidad y dedicación total. Las solicitudes vigentes reservan provisionalmente su intervalo.
- **Pago bloqueado:** falta aceptación, venció el plazo o existe un intento en conciliación.
- **Correo ausente:** usa Correos de prueba en local o revisa las credenciales y conexión del emisor.
- **Clave administrativa anterior inválida:** crea una cuenta individual con npm run admin:create.
- **PostgreSQL no conecta:** comprueba que el servicio esté iniciado y que DATABASE_URL tenga host, puerto, base, usuario y contraseña correctos.

