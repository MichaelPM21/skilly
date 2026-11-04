# Despliegue de las dos aplicaciones

Esta guía describe la arquitectura entregada. No se han publicado dominios ni creado infraestructura externa.

## Un servidor, dos procesos, dos dominios

```text
https://skilly.cl       → proxy HTTPS → 127.0.0.1:3000 → aplicación pública
https://admin.skilly.cl → proxy HTTPS → 127.0.0.1:3001 → aplicación administrativa
                                              ambas → mismo archivo SQLite
```

Ejecuta `npm run start:public` y `npm run start:admin` con un supervisor de procesos. Ambos comparten DB_PATH, configuración de pasarelas y correo. Sirve exclusivamente sus puertos HTTP mediante el proxy; no publiques la carpeta del proyecto.

SQLite utiliza WAL y transacciones para coordinar operaciones concurrentes. Usa un disco local persistente con permisos para ambos procesos. Para varias máquinas o réplicas, debe migrarse la persistencia a una base de datos de servidor.

## Configuración HTTPS

```dotenv
PORT=3000
ADMIN_PORT=3001
HOST=127.0.0.1
BASE_URL=https://skilly.cl
ADMIN_URL=https://admin.skilly.cl
DB_PATH=/ruta/persistente/skilly.db
COOKIE_SECURE=true
TRUST_PROXY=true
SEED_DEMO=false
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

Para restaurar, detén **ambos** procesos y conserva la base actual y sus archivos -wal/-shm. Copia el respaldo a una **ruta nueva**, configura ese archivo como DB_PATH en ambos procesos y vuelve a iniciar. Esto evita mezclar el respaldo con archivos WAL de otra base. Conserva el original hasta verificar la restauración.

## Alcance de esta entrega

- Contraseñas con scrypt, sesiones opacas del lado servidor y cookies HttpOnly; permisos por rol y propiedad de cada reserva.
- Sesiones pública/administrativa separadas, restricciones de origen y limitación de intentos de autenticación por proceso.
- Tokens aleatorios de un uso con vencimiento para verificación, recuperación e invitados.
- Comisiones y condiciones guardadas por reserva; importes verificados con proveedores y bloqueo de cobros duplicados o inciertos.
- Evaluaciones privadas, auditoría y adjuntos restringidos por reserva, formato y tamaño.

Las liquidaciones son simuladas y los comprobantes no son tributarios. No hay reintentos automáticos de correo, facturación electrónica ni transferencias bancarias. No se habilitaron cobros reales ni se certificó el sistema con las pasarelas. Antes de un piloto externo, completa las pruebas de sandbox, correo, restauración y condiciones de operación.
