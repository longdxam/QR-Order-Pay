import { z } from 'zod';

export const moneyVndSchema = z.number().int().nonnegative();

export const apiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    meta: z
      .object({
        page: z.number().int().optional(),
        limit: z.number().int().optional(),
        total: z.number().int().optional(),
      })
      .optional(),
    requestId: z.string().optional(),
  });

export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
  requestId: z.string().optional(),
});

export const errorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  TABLE_LOCKED: 'TABLE_LOCKED',
  TABLE_SESSION_CLOSED: 'TABLE_SESSION_CLOSED',
  TABLE_SESSION_CHECKOUT: 'TABLE_SESSION_CHECKOUT',
  TABLE_SESSION_NOT_OPEN: 'TABLE_SESSION_NOT_OPEN',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  PRICE_CHANGED: 'PRICE_CHANGED',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  STATE_TRANSITION_INVALID: 'STATE_TRANSITION_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof errorCode)[keyof typeof errorCode];

export const orderStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'SERVED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum(['UNPAID', 'PAID', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const tableSessionStatusSchema = z.enum(['OPEN', 'CHECKOUT', 'CLOSED']);
export type TableSessionStatus = z.infer<typeof tableSessionStatusSchema>;

export const roleSchema = z.enum(['ADMIN', 'STAFF']);
export type Role = z.infer<typeof roleSchema>;

export const toppingSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: moneyVndSchema,
  isAvailable: z.boolean(),
});

export const productVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: moneyVndSchema,
  isAvailable: z.boolean().optional(),
});

export const productSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  basePrice: moneyVndSchema,
  variants: z.array(productVariantSchema),
  allowedOptions: z.object({
    sizes: z.array(z.string()),
    sugarLevels: z.array(z.string()),
    iceLevels: z.array(z.string()),
    toppingIds: z.array(z.string()),
  }),
  tags: z.array(z.string()),
  ingredientMetadata: z.object({
    caffeine: z.boolean().optional(),
    dairy: z.boolean().optional(),
    flavorProfile: z.array(z.string()).optional(),
  }),
  isAvailable: z.boolean(),
  isArchived: z.boolean(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});

export const tableSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  capacity: z.number().int(),
  isActive: z.boolean(),
});

export const orderItemSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  sizeName: z.string().nullable(),
  sugarLevel: z.string(),
  iceLevel: z.string(),
  toppingIds: z.array(z.string()),
  note: z.string().max(280).optional(),
  quantity: z.number().int().positive(),
  unitPrice: moneyVndSchema,
  lineTotal: moneyVndSchema,
  nameSnapshot: z.string(),
});

export const orderSchema = z.object({
  id: z.string(),
  code: z.string(),
  tableSessionId: z.string(),
  participantId: z.string(),
  items: z.array(orderItemSchema),
  total: moneyVndSchema,
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  statusHistory: z.array(
    z.object({
      from: orderStatusSchema.nullable(),
      to: orderStatusSchema,
      at: z.string(),
      by: z.string().nullable(),
      reason: z.string().optional(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const tableSessionSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  status: tableSessionStatusSchema,
  startedAt: z.string(),
  closedAt: z.string().nullable(),
});

export const joinTableRequestSchema = z.object({
  tableToken: z.string().min(8),
});

export const placeOrderRequestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.string().nullable(),
        sugarLevel: z.string(),
        iceLevel: z.string(),
        toppingIds: z.array(z.string()),
        note: z.string().max(280).optional(),
        quantity: z.number().int().positive().max(50),
      }),
    )
    .min(1),
  note: z.string().max(280).optional(),
});

export const aiRecommendRequestSchema = z.object({
  prompt: z.string().min(1).max(500),
  maxBudget: z.number().int().positive().optional(),
  preferences: z
    .object({
      noCaffeine: z.boolean().optional(),
      noDairy: z.boolean().optional(),
      lowSugar: z.boolean().optional(),
      flavor: z.string().optional(),
    })
    .optional(),
});

export const aiRecommendResponseSchema = z.object({
  mode: z.enum(['llm', 'fallback']),
  message: z.string(),
  recommendations: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().nullable(),
      reason: z.string(),
      unitPrice: moneyVndSchema,
      name: z.string(),
      image: z.string(),
    }),
  ),
  followUpQuestion: z.string().optional(),
  latencyMs: z.number().int().optional(),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

export const openTableSessionRequestSchema = z.object({
  tableId: z.string(),
});

export const updateOrderStatusRequestSchema = z.object({
  status: orderStatusSchema,
  reason: z.string().max(280).optional(),
});

export const reviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export const serviceRequestSchema = z.object({
  type: z.enum(['CALL_STAFF', 'REQUEST_BILL', 'OTHER']),
  note: z.string().max(280).optional(),
});

export const billSchema = z.object({
  tableSessionId: z.string(),
  tableCode: z.string(),
  status: tableSessionStatusSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  subtotal: moneyVndSchema,
  total: moneyVndSchema,
  paidAmount: moneyVndSchema,
  orders: z.array(orderSchema),
});

export const dashboardOverviewSchema = z.object({
  totalRevenue: moneyVndSchema,
  orderCount: z.number().int(),
  averageOrderValue: moneyVndSchema,
  topProducts: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.number().int(),
      revenue: moneyVndSchema,
    }),
  ),
  revenueByDay: z.array(
    z.object({
      date: z.string(),
      revenue: moneyVndSchema,
      orders: z.number().int(),
    }),
  ),
  revenueByHour: z.array(
    z.object({
      hour: z.number().int().min(0).max(23),
      revenue: moneyVndSchema,
    }),
  ),
});

export * from './schemas.js';
