import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api.js';

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  status: string;
  created_at: string;
}

export interface UsersPage {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UsersParams {
  group?: string;
  page?: number;
  pageSize?: number;
}

export function useUsers(params: UsersParams = {}) {
  const qs = new URLSearchParams();
  if (params.group) qs.set('group', params.group);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();

  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => apiGet<UsersPage>(`/api/admin/users${query ? `?${query}` : ''}`),
  });
}
