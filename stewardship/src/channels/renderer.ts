export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

/**
 * Render {{variable}} slots in a template body.
 * Throws RenderError if any slot references a key not present in the variables map.
 */
export function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (!(key in variables)) {
      throw new RenderError(`Template references undefined variable: {{${key}}}`);
    }
    return variables[key];
  });
}
