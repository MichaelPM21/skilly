# Skilly en PostgreSQL

La aplicación usa PostgreSQL 18 mediante `pg`. No abre ni escribe SQLite al iniciar. `better-sqlite3` se conserva únicamente para importar un respaldo antiguo y probar esa importación.

## Resultado local del 15-11-2026

- Base activa: `skilly`, host `127.0.0.1`, puerto `5432`.
- Base de pruebas independiente: `skilly_test`.
- Usuario de aplicación: `skilly_app`, sin superusuario, creación de roles ni creación de bases.
- 20 tablas, 22 FK, índices y claves primarias.
- 169 filas del origen verificadas por conteo y SHA-256 del contenido normalizado antes de confirmar la transacción. Incluye 10 cuentas, 7 perfiles, 7 servicios, 7 reservas y 5 pagos.
- Contraseñas de cuentas conservadas como hashes; no se restablecieron.
- SQLite original y respaldo previo conservados en disco, excluidos de Git. Detalle por tabla y ruta del respaldo en `.local/postgres-import-report.json`.
- La aplicación tiene una fila de versión PostgreSQL adicional en `schema_migrations`; no es un dato de negocio importado.

En pgAdmin, actualiza **Servers → PostgreSQL 18 → Databases**. Abre **skilly → Schemas → public → Tables**. `users` contiene las cuentas y `professionals` sus perfiles profesionales. No confundas usuarios de Skilly con roles del servidor PostgreSQL.

## Configurar otra instalación

1. Instalar PostgreSQL 18 y sus herramientas de línea de comandos.
2. Crear un rol de inicio de sesión `skilly_app` con contraseña propia, sin privilegios administrativos. Crear `skilly` y `skilly_test` con ese propietario. Puede hacerse desde pgAdmin con la cuenta administradora del servidor.
3. Ejecutar `npm ci` y copiar `.env.example` a `.env` solo si no existe.
4. Configurar `DATABASE_URL` y `TEST_DATABASE_URL`. Codificar caracteres especiales de usuario/contraseña para una URL; no subir las credenciales a Git.
5. Ejecutar `npm run db:migrate`, luego `npm run admin:create` si es una instalación nueva sin cuentas, y `npm start`.

```dotenv
DATABASE_URL=postgresql://skilly_app:CONTRASENA_LOCAL@127.0.0.1:5432/skilly
TEST_DATABASE_URL=postgresql://skilly_app:CONTRASENA_LOCAL@127.0.0.1:5432/skilly_test
```

El repositorio comparte código y migraciones. Cada integrante configura sus credenciales y su base; GitHub no sincroniza filas. Esta migración es local, no publica PostgreSQL en Internet.

## Importar desde SQLite en otro entorno

No repetir sobre la base local ya migrada. El importador rechaza destinos con datos.

1. Detener los servidores que escriban en el SQLite de origen.
2. Obtener un respaldo consistente de SQLite, incluyendo su WAL. Conservar el archivo original.
3. Configurar DATABASE_URL hacia una base PostgreSQL vacía. No crear cuentas antes de importar.
4. Ejecutar `node scripts/import-sqlite.js RUTA_DEL_RESPALDO.db`.
5. Revisar `.local/postgres-import-report.json`, ejecutar las pruebas y arrancar ambos servidores.

El importador abre SQLite en modo lectura, valida integridad, importa en una transacción, comprueba el contenido de cada tabla y fuerza la validación de todas las FK antes de COMMIT. Una referencia inválida o un dato distinto provoca ROLLBACK. No elimina registros para ocultar errores. Una cancelación antigua sin pago usa NULL en vez de una cadena vacía; solo se acepta esa normalización cuando su monto es cero. El orden `rowid` de eventos se preserva como `event_sequence` y las secuencias de PostgreSQL se reajustan.

## Respaldar y restaurar

`npm run db:backup` genera un `.dump` consistente mediante `pg_dump` en `.local/backups`. En Windows detecta las herramientas instaladas; `PG_BIN` permite indicar su carpeta. Usar cliente PostgreSQL 18 o posterior compatible con el servidor.

Restaurar primero en una base **nueva y vacía**, mediante la opción Restore de pgAdmin o `pg_restore --exit-on-error --single-transaction --no-owner`. La contraseña se introduce localmente o por variables de entorno, no en argumentos publicados. Cambiar DATABASE_URL a la copia restaurada solo después de verificarla. La suite prueba respaldo y restauración reales dentro de un esquema desechable de `skilly_test`.

Para volver excepcionalmente a SQLite se necesita tanto la versión anterior del código como su respaldo y configuración; cambiar DATABASE_URL no convierte PostgreSQL a SQLite. Las nuevas operaciones posteriores a la migración no estarán en el respaldo antiguo.

## Pruebas y límites

`npm run test:evidence` ejecuta los casos HTTP contra PostgreSQL real, con esquemas temporales y proveedores de pago/correo controlados. TEST_DATABASE_URL debe apuntar a una base terminada en `_test`; las pruebas no limpian `skilly`. Incluyen importación con rollback ante huérfanos, conservación de hashes y documentos binarios, restauración, exclusividad del correo, transacciones anidadas y arranque concurrente.

Las transacciones conservan una conexión mediante AsyncLocalStorage y usan un bloqueo asesor compartido para serializar secciones críticas entre los servidores. Esto prioriza corrección de reservas y pagos; no es una certificación de rendimiento bajo carga. Las llamadas a pasarelas permanecen fuera de esas secciones. Referencias polimórficas y JSON en TEXT siguen validados por la aplicación.

El workflow de GitHub incorpora PostgreSQL 18 y clientes compatibles. Su resultado remoto debe verificarse después de publicar los commits; las pruebas locales no equivalen a una ejecución de Actions.

Referencias de implementación: [transacciones de node-postgres](https://node-postgres.com/features/transactions) y [repositorio PostgreSQL para Ubuntu](https://www.postgresql.org/download/linux/ubuntu/).
