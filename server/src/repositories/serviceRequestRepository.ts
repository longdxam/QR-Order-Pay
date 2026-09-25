import type { ClientSession } from 'mongoose';
import { ServiceRequestModel } from '../models/ServiceRequest.js';

export const serviceRequestRepository = {
  async create(
    data: {
      tableSessionId: string;
      participantId: string;
      type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER';
      note?: string;
    },
    session?: ClientSession | null,
  ) {
    if (!session) return ServiceRequestModel.create(data);
    return ServiceRequestModel.create([data], { session }).then((items) => items[0]!);
  },
  async listOpen() {
    return ServiceRequestModel.find({ status: 'OPEN' }).sort({ createdAt: -1 });
  },
  async listBySession(tableSessionId: string, session?: ClientSession | null) {
    return ServiceRequestModel.find({ tableSessionId }, null, {
      session: session ?? undefined,
    }).sort({ createdAt: -1 });
  },
  async resolve(id: string, resolvedBy: string, session?: ClientSession | null) {
    return ServiceRequestModel.findOneAndUpdate(
      { _id: id, status: 'OPEN' },
      { status: 'RESOLVED', resolvedBy, resolvedAt: new Date() },
      { new: true, session: session ?? undefined },
    );
  },
};
