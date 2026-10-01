/** Quote one argument for the sandbox's POSIX shell. Never interpolate raw arguments. */
export function shellQuote(value: string): string {
  if (value.includes("\0")) throw new TypeError("命令参数不能包含空字符");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function shellCommand(args: readonly string[]): string {
  return args.map(shellQuote).join(" ");
}
