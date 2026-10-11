export class SessionModel {
  private static readonly idPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  static isValidId(value: unknown): value is string {
    return typeof value === "string" && this.idPattern.test(value);
  }
}
