import compileLodashTemplate from 'lodash.template'

type TemplateContext = Record<string, unknown>
type TemplateRenderer = (context: TemplateContext) => string

export function compileTemplate(source: string): TemplateRenderer {
  return compileLodashTemplate(source, { imports: { String } }) as TemplateRenderer
}
