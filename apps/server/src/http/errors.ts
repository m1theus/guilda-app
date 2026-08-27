import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { RepositoryError } from '../repository.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
export const badRequest = (message: string, details?: Record<string, string[]>) =>
  new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Insufficient permissions') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') =>
  new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);
export const tooMany = (message = 'Too many requests') =>
  new HttpError(429, 'RATE_LIMITED', message);

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const e =
    error instanceof ZodError
      ? new HttpError(
          400,
          'BAD_REQUEST',
          'Invalid request',
          error.flatten().fieldErrors as Record<string, string[]>,
        )
      : error instanceof HttpError
        ? error
        : error instanceof RepositoryError
          ? repositoryHttpError(error)
          : isClientError(error)
            ? new HttpError(error.statusCode, 'BAD_REQUEST', error.message)
            : new HttpError(500, 'INTERNAL_ERROR', 'Internal server error');
  if (e.statusCode >= 500)
    request.log.error({ err: error, requestId: request.id }, 'request failed');
  reply.status(e.statusCode).send({
    code: e.code,
    message: e.message,
    requestId: request.id,
    ...(e.details ? { details: e.details } : {}),
  });
}

function repositoryHttpError(error: RepositoryError): HttpError {
  switch (error.code) {
    case 'ATTACHMENT_CLAIM_INVALID':
      return conflict('One or more attachments cannot be claimed');
    case 'SELF_RELATION':
      return new HttpError(400, error.code, 'A user cannot relate to themselves');
    case 'USER_NOT_FOUND':
      return new HttpError(404, error.code, 'User not found');
    case 'BLOCK_NOT_FOUND':
      return new HttpError(404, error.code, 'Block not found');
    case 'FRIEND_REQUEST_NOT_FOUND':
      return new HttpError(404, error.code, 'Friend request not found');
    case 'FRIENDSHIP_NOT_FOUND':
      return new HttpError(404, error.code, 'Friendship not found');
    case 'CONVERSATION_NOT_FOUND':
      return new HttpError(404, error.code, 'Direct conversation not found');
    case 'DIRECT_MESSAGE_NOT_FOUND':
      return new HttpError(404, error.code, 'Direct message not found');
    case 'RELATION_BLOCKED':
      return new HttpError(403, error.code, 'This action is unavailable because a user is blocked');
    case 'FORBIDDEN':
      return new HttpError(403, error.code, 'This action is not allowed');
    case 'FRIEND_REQUEST_EXISTS':
      return new HttpError(409, error.code, 'A friendship or request already exists');
    case 'FRIENDSHIP_REQUIRED':
      return new HttpError(409, error.code, 'An accepted friendship is required');
    default:
      return new HttpError(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

function isClientError(error: unknown): error is Error & { statusCode: number } {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}
