import { AuditLogModel } from '../models/AuditLog.js';

export const auditRepository = {
  async log(data: {
    actorType: 'USER' | 'GUEST' | 'SYSTEM';
    actorId?: string | null;
    participantId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return AuditLogModel.create({
      actorType: data.actorType,
      actorId: data.actorId ?? null,
      participantId: data.participantId ?? null,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId ?? null,
      metadata: data.metadata ?? {},
    });
  },
};
