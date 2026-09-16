import { serviceRequestRepository } from '../repositories/serviceRequestRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { publishSession, publishStaff } from '../realtime/socket.js';
import { tableRepository } from '../repositories/tableRepository.js';

export async function createServiceRequest(input: {
  tableSessionId: string;
  participantId: string;
  type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER';
  note?: string;
}) {
  const session = await tableSessionRepository.findById(input.tableSessionId);
  if (!session) throw new NotFoundError('Phiên không tồn tại.');
  if (session.status === 'CLOSED') throw new ForbiddenError('Phiên đã đóng.');
  const existing = await serviceRequestRepository.listBySession(input.tableSessionId);
  const duplicate = existing.find((r) => r.status === 'OPEN' && r.participantId === input.participantId && r.type === input.type);
  if (duplicate) throw new ConflictError('CONFLICT', 'Bạn đã gửi yêu cầu này, vui lòng chờ nhân viên.');
  const created = await serviceRequestRepository.create(input);
  await auditRepository.log({
    actorType: 'GUEST',
    participantId: input.participantId,
    action: 'serviceRequest.created',
    entityType: 'ServiceRequest',
    entityId: created._id.toString(),
    metadata: { type: input.type },
  });
  publishStaff('serviceRequest.created', { tableSessionId: input.tableSessionId });
  return created;
}

export async function resolve(id: string, staffId: string) {
  const updated = await serviceRequestRepository.resolve(id, staffId);
  if (!updated) throw new NotFoundError('Yêu cầu không tồn tại.');
  await auditRepository.log({
    actorType: 'USER',
    actorId: staffId,
    action: 'serviceRequest.resolved',
    entityType: 'ServiceRequest',
    entityId: id,
  });
  publishStaff('serviceRequest.resolved', { tableSessionId: updated.tableSessionId.toString() });
  publishSession(updated.tableSessionId.toString(), 'serviceRequest.resolved', { type: updated.type });
  return updated;
}

export async function listOpen() {
  const requests = await serviceRequestRepository.listOpen();
  return Promise.all(requests.map(async (r) => {
    const session = await tableSessionRepository.findById(r.tableSessionId.toString());
    const table = session ? await tableRepository.findById(session.tableId.toString()) : null;
    return { ...r.toObject(), tableName: table?.name ?? 'Bàn' };
  }));
}

export const listOpenServiceRequests = listOpen;
