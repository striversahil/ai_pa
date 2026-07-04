"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useInMemoryDb = exports.prisma = void 0;
exports.checkDatabaseConnection = checkDatabaseConnection;
const client_1 = require("@prisma/client");
const logger_1 = require("./logger");
exports.prisma = new client_1.PrismaClient({
    log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
    ],
});
// Log Prisma queries in development mode for easier debugging
exports.prisma.$on('query', (e) => {
    logger_1.logger.debug(`Prisma Query: ${e.query} | Params: ${e.params} | Duration: ${e.duration}ms`);
});
// Global flag to track memory fallback status
exports.useInMemoryDb = false;
async function checkDatabaseConnection() {
    try {
        logger_1.logger.info('Testing connection to PostgreSQL database...');
        // Quick test query
        await exports.prisma.$queryRaw `SELECT 1`;
        logger_1.logger.info('✅ PostgreSQL database connection successful.');
        exports.useInMemoryDb = false;
        return true;
    }
    catch (error) {
        logger_1.logger.warn('⚠️ Database connection failed or is unconfigured.');
        logger_1.logger.warn('👉 App will run in IN-MEMORY DATABASE mode with pre-seeded mock records.');
        exports.useInMemoryDb = true;
        return false;
    }
}
