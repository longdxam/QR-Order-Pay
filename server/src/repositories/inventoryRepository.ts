import type { ClientSession } from 'mongoose';
import { IngredientModel } from '../models/Ingredient.js';
import { RecipeModel } from '../models/Recipe.js';
import { StockMovementModel } from '../models/StockMovement.js';

export const ingredientRepository = {
  async listByName() {
    return IngredientModel.find().sort({ name: 1 });
  },
  async findById(id: string, session: ClientSession) {
    return IngredientModel.findById(id).session(session);
  },
  async create(data: Record<string, unknown>, session: ClientSession) {
    const [ingredient] = await IngredientModel.create([data], { session });
    return ingredient;
  },
  /** Sửa thông tin theo version; chỉ ngừng dùng được khi không còn phần đang giữ cho đơn. */
  async update(
    id: string,
    expectedVersion: number,
    deactivating: boolean,
    set: Record<string, unknown>,
    session: ClientSession,
  ) {
    return IngredientModel.findOneAndUpdate(
      { _id: id, version: expectedVersion, ...(deactivating ? { reserved: 0 } : {}) },
      { $set: set, $inc: { version: 1 } },
      { new: true, session },
    );
  },
  async setOnHand(id: string, version: number, onHand: number, session: ClientSession) {
    return IngredientModel.findOneAndUpdate(
      { _id: id, version },
      { $set: { onHand }, $inc: { version: 1 } },
      { new: true, session },
    );
  },
  /** Khóa nguyên liệu dùng trong công thức; `activeOnly` khi bật công thức. */
  async lock(id: unknown, activeOnly: boolean, session: ClientSession) {
    return IngredientModel.findOneAndUpdate(
      { _id: id, ...(activeOnly ? { isActive: true } : {}) },
      { $inc: { version: 1 } },
      { new: true, session },
    );
  },
  /** Xóa hẳn chỉ khi tồn và phần giữ đều bằng 0 (điều kiện kiểm tra lại ngay lúc xóa). */
  async deleteEmpty(id: string, session: ClientSession) {
    return IngredientModel.findOneAndDelete({ _id: id, onHand: 0, reserved: 0 }, { session });
  },
  async listAll(session?: ClientSession | null) {
    return IngredientModel.find({})
      .session(session ?? null)
      .lean();
  },
};

export const recipeRepository = {
  /** Có công thức nào (bật hay tắt, nền hay theo size) dùng nguyên liệu này không. */
  async usesIngredient(ingredientId: string, session: ClientSession): Promise<boolean> {
    return !!(await RecipeModel.exists({
      $or: [
        { 'components.ingredientId': ingredientId },
        { 'variants.components.ingredientId': ingredientId },
      ],
    }).session(session));
  },
  async listRecent() {
    return RecipeModel.find().sort({ updatedAt: -1 });
  },
  async findForTarget(targetType: string, targetId: string, session: ClientSession) {
    return RecipeModel.findOne({ targetType, targetId }).session(session);
  },
  async create(data: Record<string, unknown>, session: ClientSession): Promise<void> {
    await RecipeModel.create([data], { session });
  },
  async listEnabled(session?: ClientSession | null) {
    return RecipeModel.find({ enabled: true })
      .session(session ?? null)
      .lean();
  },
};

/** Thay đổi tồn kho nguyên tử: chỉ thành công khi còn đủ hàng/đủ phần đang giữ. */
export const stockRepository = {
  /** Giữ `quantity` nếu tồn khả dụng (onHand - reserved) đủ và nguyên liệu còn dùng. */
  async reserve(ingredientId: unknown, quantity: number, session: ClientSession) {
    return IngredientModel.findOneAndUpdate(
      {
        _id: ingredientId,
        isActive: true,
        $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity] },
      },
      { $inc: { reserved: quantity, version: 1 } },
      { new: true, session },
    );
  },
  /** Trả phần đã giữ; `consume` thì đồng thời trừ tồn thực tế (xuất kho khi pha). */
  async settleReserved(
    ingredientId: unknown,
    quantity: number,
    consume: boolean,
    session: ClientSession,
  ) {
    return IngredientModel.findOneAndUpdate(
      {
        _id: ingredientId,
        reserved: { $gte: quantity },
        ...(consume ? { onHand: { $gte: quantity } } : {}),
      },
      { $inc: { reserved: -quantity, onHand: consume ? -quantity : 0, version: 1 } },
      { new: true, session },
    );
  },
  async recordMovement(data: Record<string, unknown>, session: ClientSession): Promise<void> {
    await StockMovementModel.create([data], { session });
  },
};

export const stockMovementRepository = {
  async existsForIngredient(ingredientId: string, session: ClientSession): Promise<boolean> {
    return !!(await StockMovementModel.exists({ ingredientId }).session(session));
  },
  async findByIdempotency(idempotencyKey: string) {
    return StockMovementModel.findOne({ idempotencyKey });
  },
  async create(data: Record<string, unknown>, session: ClientSession) {
    const [movement] = await StockMovementModel.create([data], { session });
    return movement;
  },
  /** Mới nhất trước, 30 dòng mỗi trang, kèm tên người thao tác. */
  async page(filter: Record<string, unknown>, page: number) {
    const total = await StockMovementModel.countDocuments(filter);
    const movements = await StockMovementModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * 30)
      .limit(30)
      .populate<{ actorId: { name: string } | null }>('actorId', 'name');
    return { total, movements };
  },
};
