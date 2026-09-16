import { productRepository } from '../repositories/productRepository.js';
import { categoryRepository } from '../repositories/categoryRepository.js';
import { toppingRepository } from '../repositories/toppingRepository.js';
import { NotFoundError } from '../errors/AppError.js';

export async function listPublicMenu() {
  const [categories, products, toppings] = await Promise.all([
    categoryRepository.listActive(),
    productRepository.listPublic({}),
    toppingRepository.listAvailable(),
  ]);
  return { categories, products, toppings };
}

export async function listFeatured(limit?: number) {
  return productRepository.listFeatured(limit);
}

export async function getProductDetail(id: string) {
  const product = await productRepository.findById(id);
  if (!product || product.isArchived) throw new NotFoundError('Món không tồn tại.');
  return product;
}

export async function listAdminProducts() {
  return productRepository.listAll();
}

export async function listAdminCategories() {
  return categoryRepository.listAll();
}

export async function listAdminToppings() {
  return toppingRepository.listAll();
}
