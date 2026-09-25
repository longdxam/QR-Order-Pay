import { serviceRequestRepository } from '../repositories/serviceRequestRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { outboxRepository } from '../repositories/outboxRepository.js';

export async function createServiceRequest(input: {
  tableSessionId: string;
  participantId: string;
  type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER';
  note?: string;
}) {
  return unitOfWork.withTransaction(async (mongoSession) => {
    const session = await tableSessionRepository.findById(input.tableSessionId, mongoSession);
    if (!session) throw new NotFoundError('Phiên không tồn tại.');
    if (session.status === 'CLOSED') throw new ForbiddenError('Phiên đã đóng.');
    const existing = await serviceRequestRepository.listBySession(
      input.tableSessionId,
      mongoSession,
    );
    const duplicate = existing.find(
      (r) =>
        r.status === 'OPEN' && r.participantId === input.participantId && r.type === input.type,
    );
    if (duplicate)
      throw new ConflictError('CONFLICT', 'Bạn đã gửi yêu cầu này, vui lòng chờ nhân viên.');
    const created = await serviceRequestRepository.create(input, mongoSession);
    await auditRepository.log(
      {
        actorType: 'GUEST',
        participantId: input.participantId,
        action: 'serviceRequest.created',
        entityType: 'ServiceRequest',
        entityId: created._id.toString(),
        metadata: { type: input.type },
      },
      mongoSession,
    );
    await outboxRepository.createRealtimeEvents(
      [
        {
          eventType: 'serviceRequest.created',
          aggregateType: 'ServiceRequest',
          aggregateId: created.id,
          target: { scope: 'staff' },
          payload: {
            serviceRequestId: created.id,
            tableSessionId: input.tableSessionId,
            type: input.type,
          },
        },
      ],
      mongoSession,
    );
    return created;
  });
}

export async function resolve(id: string, staffId: string) {
  return unitOfWork.withTransaction(async (mongoSession) => {
    const updated = await serviceRequestRepository.resolve(id, staffId, mongoSession);
    if (!updated) throw new NotFoundError('Yêu cầu không tồn tại hoặc đã được xử lý.');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId: staffId,
        action: 'serviceRequest.resolved',
        entityType: 'ServiceRequest',
        entityId: id,
      },
      mongoSession,
    );
    const tableSessionId = updated.tableSessionId.toString();
    const payload = { serviceRequestId: updated.id, tableSessionId, type: updated.type };
    const base = {
      eventType: 'serviceRequest.resolved' as const,
      aggregateType: 'ServiceRequest',
      aggregateId: updated.id,
      payload,
    };
    await outboxRepository.createRealtimeEvents(
      [
        { ...base, target: { scope: 'staff' } },
        { ...base, target: { scope: 'session', tableSessionId } },
      ],
      mongoSession,
    );
    return updated;
  });
}

export async function listOpen() {
  const requests = await serviceRequestRepository.listOpen();
  return Promise.all(
    requests.map(async (r) => {
      const session = await tableSessionRepository.findById(r.tableSessionId.toString());
      const table = session ? await tableRepository.findById(session.tableId.toString()) : null;
      return { ...r.toObject(), tableName: table?.name ?? 'Bàn' };
    }),
  );
}

export const listOpenServiceRequests = listOpen;
