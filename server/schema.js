/**
 * @file Puente de compatibilidad: exporta postgres-migrations.js. migrate aplica
 * database/postgres/001-initial.sql y comprueba su hash antes de iniciar la aplicación.
 */

module.exports = require('./postgres-migrations');
