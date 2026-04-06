type LogFields = Record<string, unknown>;

const isDev = process.env.NODE_ENV === "development";

function format(level: string, message: string, fields?: LogFields): string {
  const base = `[${level}] ${message}`;
  if (!fields || Object.keys(fields).length === 0) return base;
  return `${base} ${JSON.stringify(fields)}`;
}

export const logger = {
  debug(message: string, fields?: LogFields): void {
    if (isDev) console.debug(format("DEBUG", message, fields));
  },
  info(message: string, fields?: LogFields): void {
    if (isDev) console.info(format("INFO", message, fields));
  },
  warn(message: string, fields?: LogFields): void {
    console.warn(format("WARN", message, fields));
  },
  error(message: string, fields?: LogFields): void {
    console.error(format("ERROR", message, fields));
  },
};
