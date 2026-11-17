/**
 * Flujo del módulo. Puente de compatibilidad: exporta postgres.js. La aplicación actual usa
 * DATABASE_URL y PostgreSQL; better-sqlite3 se conserva para importar respaldos antiguos, no
 * para el funcionamiento diario.
 */

module.exports = require('./postgres');
