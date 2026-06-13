import type { ModuleManifest } from '@panacea/shared';

export const manifest: ModuleManifest = {
  name: 'admin',
  apiPrefix: '/api/admin',
  nav: [
    { label: 'Users', path: '/admin/users' },
    { label: 'Groups', path: '/admin/groups' },
    { label: 'Roles', path: '/admin/roles' },
    { label: 'Audit log', path: '/admin/audit' },
    { label: 'Import / Export', path: '/admin/data' },
  ],
  routes: [
    { path: '/admin/users', component: 'UserList' },
    { path: '/admin/groups', component: 'GroupDetail' },
    { path: '/admin/roles', component: 'RoleAccessConfig' },
    { path: '/admin/audit', component: 'AuditLog' },
    { path: '/admin/data', component: 'ImportExport' },
  ],
  permissions: [
    { key: 'admin:access', label: 'Access Admin', level: 'module' },

    { key: 'admin:users:access', label: 'Users', level: 'page', page: 'Users' },
    { key: 'admin:users:read', label: 'View users', level: 'function', page: 'Users' },
    { key: 'admin:users:create', label: 'Create user', level: 'function', page: 'Users' },
    { key: 'admin:users:update', label: 'Edit user', level: 'function', page: 'Users' },
    { key: 'admin:users:deactivate', label: 'Deactivate / reactivate user', level: 'function', page: 'Users' },

    { key: 'admin:groups:access', label: 'Groups', level: 'page', page: 'Groups' },
    { key: 'admin:groups:read', label: 'View groups', level: 'function', page: 'Groups' },
    { key: 'admin:groups:manage', label: 'Manage groups & members', level: 'function', page: 'Groups' },

    { key: 'admin:roles:access', label: 'Roles', level: 'page', page: 'Roles' },
    { key: 'admin:roles:read', label: 'View roles', level: 'function', page: 'Roles' },
    { key: 'admin:roles:manage', label: 'Create roles', level: 'function', page: 'Roles' },
    { key: 'admin:roles:assign', label: 'Assign permissions & roles', level: 'function', page: 'Roles' },

    { key: 'admin:audit:access', label: 'Audit log', level: 'page', page: 'Audit' },
    { key: 'admin:audit:read', label: 'View audit log', level: 'function', page: 'Audit' },
    { key: 'admin:audit:revert', label: 'Revert change', level: 'function', page: 'Audit' },

    { key: 'admin:data:access', label: 'Import / Export', level: 'page', page: 'Import/Export' },
    { key: 'admin:export', label: 'Export data', level: 'function', page: 'Import/Export' },
    { key: 'admin:import', label: 'Import data', level: 'function', page: 'Import/Export' },
  ],
  events: {
    publishes: ['user.created', 'user.deactivated', 'user.reactivated', 'group.updated'],
    subscribes: [],
  },
};
