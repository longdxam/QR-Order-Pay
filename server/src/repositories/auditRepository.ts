import type { ClientSession } from 'mongoose';
import { AuditLogModel } from '../models/AuditLog.js';

export const auditRepository = {
  async log(
    data: {
      actorType: 'USER' | 'GUEST' | 'SYSTEM';
      actorId?: string | null;
      participantId?: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      metadata?: Record<string, unknown>;
    },
    session?: ClientSession | null,
  ) {
    const document = {
      actorType: data.actorType,
      actorId: data.actorId ?? null,
      participantId: data.participantId ?? null,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId ?? null,
      metadata: data.metadata ?? {},
    };
    if (!session) return AuditLogModel.create(document);
    return AuditLogModel.create([document], { session }).then((items) => items[0]!);
  },
};
