import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';
import { expect, it } from 'vitest';

const srcRoot = resolve(process.cwd(), 'apps/web-antd/src');
const routeRoot = resolve(srcRoot, 'router/routes/modules');

/** A route component with children must render a nested outlet; otherwise navigation only changes the URL. */
it('all statically declared child routes have a rendering outlet in their parent component', () => {
  const missing: string[] = [];
  const checked: string[] = [];
  for (const file of readdirSync(routeRoot).filter((name) => name.endsWith('.ts'))) {
    const routeSource = readFileSync(resolve(routeRoot, file), 'utf8');
    const source = ts.createSourceFile(file, routeSource, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (ts.isObjectLiteralExpression(node)) {
        const children = node.properties.find((prop) =>
          ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'children');
        const component = node.properties.find((prop) =>
          ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'component');
        if (children && component && ts.isPropertyAssignment(component)) {
          const path = component.initializer.getText(source).match(/import\(['"]#\/([^'"]+\.vue)['"]\)/)?.[1];
          if (path) {
            checked.push(path);
            const viewSource = readFileSync(resolve(srcRoot, path), 'utf8');
            const template = parse(viewSource).descriptor.template?.content ?? '';
            if (!/<(?:RouterView|router-view)\b/i.test(template)) {
              missing.push(`${file}: ${path}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(checked).toEqual(expect.arrayContaining([
    'views/ipd/bid/list/index.vue',
    'views/ipd/product/workspace/index.vue',
    'views/ipd/project/list/index.vue',
  ]));
  expect(missing).toEqual([]);
});
