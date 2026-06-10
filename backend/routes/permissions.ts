import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';

interface PermRow {
  key: string;
  label: string;
  level: string;
  module: string;
  page: string | null;
}

interface Leaf {
  key: string;
  label: string;
}
interface PageNode {
  page: string;
  access: Leaf | null;
  functions: Leaf[];
}
interface ModuleNode {
  module: string;
  access: Leaf | null;
  functions: Leaf[];
  pages: PageNode[];
}

function buildTree(rows: PermRow[]): ModuleNode[] {
  const modules = new Map<string, ModuleNode>();
  const pageIndex = new Map<string, Map<string, PageNode>>();

  const getModule = (name: string): ModuleNode => {
    let m = modules.get(name);
    if (!m) {
      m = { module: name, access: null, functions: [], pages: [] };
      modules.set(name, m);
      pageIndex.set(name, new Map());
    }
    return m;
  };
  const getPage = (moduleName: string, page: string): PageNode => {
    const m = getModule(moduleName);
    const pages = pageIndex.get(moduleName)!;
    let p = pages.get(page);
    if (!p) {
      p = { page, access: null, functions: [] };
      pages.set(page, p);
      m.pages.push(p);
    }
    return p;
  };

  for (const r of rows) {
    const leaf: Leaf = { key: r.key, label: r.label };
    if (r.level === 'module') {
      getModule(r.module).access = leaf;
    } else if (r.level === 'page' && r.page) {
      getPage(r.module, r.page).access = leaf;
    } else if (r.page) {
      getPage(r.module, r.page).functions.push(leaf);
    } else {
      getModule(r.module).functions.push(leaf);
    }
  }

  return [...modules.values()];
}

const permissionsRoutes: FastifyPluginAsync<{ db: Sql }> = async (app, { db }) => {
  app.get(
    '/permissions',
    { preHandler: app.requirePermission('admin:roles:read') },
    async () => {
      const rows = await db<PermRow[]>`
        SELECT key, label, level, module, page
        FROM permissions ORDER BY module, sort_order, key`;
      return { modules: buildTree(rows) };
    },
  );
};

export default permissionsRoutes;
