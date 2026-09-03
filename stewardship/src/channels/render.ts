/**
 * Substitutes {{variable}} slots in a template body.
 * Throws if any declared variable is missing from the provided map.
 */
export function renderTemplate(
  body: string,
  variables: string[],
  values: Record<string, string>,
): string {
  for (const name of variables) {
    if (!(name in values)) {
      throw new Error(`Missing template variable: ${name}`);
    }
  }
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) {
      throw new Error(`Unknown template variable in body: ${key}`);
    }
    return values[key];
  });
}
