'use strict';

/**
 * logger.js
 *
 * Small structured logging utility for the NLP pipeline.
 *
 * Logs are written as JSON so Azure Functions can capture them
 * as traces through Application Insights.
 *
 * Usage:
 *   const log = require('./logger')('fn-enrich');
 *
 *   log.info('Processing article', { urlHash: 'abc123' });
 *   log.error('Language API failed', {
 *     urlHash,
 *     error: err.message
 *   });
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};


// LOG_LEVEL controls the minimum level that will be written.
// Defaults to "info" when the environment variable is absent
// or does not match a supported level.
const configuredLevel =
  process.env.LOG_LEVEL?.toLowerCase();

const MIN_LEVEL =
  LOG_LEVELS[configuredLevel] ??
  LOG_LEVELS.info;


/**
 * Create a logger associated with a specific pipeline component.
 *
 * @param {string} component
 * @returns {{debug, info, warn, error}}
 */
function createLogger(component) {

  /**
   * Write one structured log entry.
   */
  function writeLog(
    level,
    message,
    metadata = {}
  ) {
    if (LOG_LEVELS[level] < MIN_LEVEL) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...metadata
    };

    const output =
      JSON.stringify(logEntry);

    // Azure Functions captures stdout/stderr
    // and forwards the traces to Application Insights.
    switch (level) {
      case 'error':
        console.error(output);
        break;

      case 'warn':
        console.warn(output);
        break;

      default:
        console.log(output);
        break;
    }
  }


  return {
    debug(message, metadata) {
      writeLog(
        'debug',
        message,
        metadata
      );
    },

    info(message, metadata) {
      writeLog(
        'info',
        message,
        metadata
      );
    },

    warn(message, metadata) {
      writeLog(
        'warn',
        message,
        metadata
      );
    },

    error(message, metadata) {
      writeLog(
        'error',
        message,
        metadata
      );
    }
  };
}


module.exports = createLogger;