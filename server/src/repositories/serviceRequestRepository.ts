import { ServiceRequestModel } from '../models/ServiceRequest.js';

export const serviceRequestRepository = {
  async create(data: { tableSessionId: string; participantId: string; type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER'; note?: string }) {
    return ServiceRequestModel.create(data);
  },
  async listOpen() {
    return ServiceRequestModel.find({ status: 'OPEN' }).sort({ createdAt: -1 });
  },
  async listBySession(tableSessionId: string) {
    return ServiceRequestModel.find({ tableSessionId }).sort({ createdAt: -1 });
  },
  async resolve(id: string, resolvedBy: string) {
    return ServiceRequestModel.findByIdAndUpdate(id, { status: 'RESOLVED', resolvedBy, resolvedAt: new Date() }, { new: true });
  },
};
