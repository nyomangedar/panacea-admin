import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import permissionsRoutes from './routes/permissions.js';
import usersRoutes from './routes/users.js';
import groupsRoutes from './routes/groups.js';
import rolesRoutes from './routes/roles.js';
import auditRoutes from './routes/audit.js';
import importExportRoutes from './routes/import-export.js';

// Admin module backend plugin. Registered into the shell (or the testkit) with a
// `db` and the core rbac/audit decorators already in scope.
export const adminPlugin: FastifyPluginAsync<{ db: Sql }> = async (app, opts) => {
  await app.register(permissionsRoutes, opts);
  await app.register(usersRoutes, opts);
  await app.register(groupsRoutes, opts);
  await app.register(rolesRoutes, opts);
  await app.register(auditRoutes, opts);
  await app.register(importExportRoutes, opts);
};

export default adminPlugin;
