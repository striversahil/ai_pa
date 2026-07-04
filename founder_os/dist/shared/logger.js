"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("../config");
const isDevelopment = config_1.config.NODE_ENV === 'development';
exports.logger = (0, pino_1.default)({
    level: isDevelopment ? 'debug' : 'info',
    transport: isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
});
