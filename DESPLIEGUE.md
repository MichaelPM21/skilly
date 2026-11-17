# Despliegue de las dos aplicaciones

Esta guía describe la arquitectura entregada. No se han publicado dominios ni creado infraestructura externa.

## Un servidor, dos procesos, dos dominios

```text
https://skilly.cl       → proxy HTTPS → 127.0.0.1:3000 → aplicación pública
https://admin.skilly.cl → proxy HTTPS → 127.0.0.1:3001 → aplicación administrativa
                                              ambas → misma base PostgreSQL
```

Ejecuta `npm run start:public` y `npm run start:admin` con un supervisor de procesos. Ambos comparten DATABASE_URL, configuración de pasarelas y correo. Sirve exclusivamente sus puertos HTTP mediante el proxy; no publiques la carpeta del proyecto.

PostgreSQL conserva la persistencia compartida. Las transacciones críticas usan un bloqueo asesor para mantener las reglas de negocio entre ambos servidores. Configura TLS si la base está fuera del equipo y limita el acceso a los servidores de aplicación.

## Configuración HTTPS

```dotenv
PORT=3000
ADMIN_PORT=3001
HOST=127.0.0.1
BASE_URL=https://skilly.cl
ADMIN_URL=https://admin.skilly.cl
DATABASE_URL=postgresql://skilly_app:CAMBIAR@servidor:5432/skilly
COOKIE_SECURE=true
TRUST_PROXY=true
NODE_ENV=production
WEBPAY_ENV=integration
PAYPAL_ENV=sandbox
```

TRUST_PROXY=true corresponde a un único proxy de confianza. Debe reemplazar los encabezados de IP reenviada y bloquear el acceso directo externo a los puertos. Configura DNS y TLS para ambos dominios. BASE_URL y ADMIN_URL deben coincidir con los orígenes del navegador.

NODE_ENV=production desactiva el pago simulado y la bandeja de correos de prueba. Los ambientes de pasarelas se configuran por separado: conserva integración/sandbox para esta versión. El modo de desarrollo, con su bandeja de enlaces, es para pruebas locales privadas.

## Operación y restauración

1. Instala con `npm ci` y prepara .env sin publicarlo.
2. Antes de actualizar, ejecuta `npm run db:backup`. Conserva una copia fuera del servidor según tu política interna.
3. Crea el primer administrador con `npm run admin:create`, si aún no existe.
4. Inicia ambos procesos y comprueba cada dominio con su rol.
5. Configura correo y prueba verificación, invitaciones, recuperación y acceso de invitados.
6. Completa pruebas contra Webpay integración y PayPal sandbox con las credenciales correspondientes.

Para restaurar, detén ambos procesos y restaura el `.dump` con `pg_restore --exit-on-error --single-transaction --no-owner` sobre una base nueva y vacía. Configura DATABASE_URL para esa base, comprueba los datos y vuelve a iniciar. Conserva la base anterior hasta validar la restauración.

## Alcance de esta entrega

- Contraseñas con scrypt, sesiones opacas del lado servidor y cookies HttpOnly; permisos por rol y propiedad de cada reserva.
- Sesiones pública/administrativa separadas, restricciones de origen y limitación de intentos de autenticación por proceso.
- Tokens aleatorios de un uso con vencimiento para verificación, recuperación e invitados.
- Comisiones y condiciones guardadas por reserva; importes verificados con proveedores y bloqueo de cobros duplicados o inciertos.
- Evaluaciones privadas, auditoría y adjuntos restringidos por reserva, formato y tamaño.

Las liquidaciones son simuladas y los comprobantes no son tributarios. No hay reintentos automáticos de correo, facturación electrónica ni transferencias bancarias. No se habilitaron cobros reales ni se certificó el sistema con las pasarelas. Antes de un piloto externo, completa las pruebas de sandbox, correo, restauración y condiciones de operación.
