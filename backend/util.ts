import type { FastifyRequest } from 'fastify';

export function actorId(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } | null }).user?.sub ?? null;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
