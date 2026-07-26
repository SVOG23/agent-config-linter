export interface Colors {
  red(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  green(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

function wrap(open: number, close: number): (s: string) => string {
  return (s) => `[${open}m${s}[${close}m`;
}

const identity = (s: string) => s;

export function colorize(enabled: boolean): Colors {
  if (!enabled) {
    return {
      red: identity,
      yellow: identity,
      blue: identity,
      green: identity,
      dim: identity,
      bold: identity,
    };
  }
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    green: wrap(32, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}
