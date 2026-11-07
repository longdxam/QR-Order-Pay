// Response-only compatibility for recipes already stored on historical orders.
// No configuration, recommendation, token or order-creation contract remains.
export interface FreestyleView {
  name: string;
  instructions: string;
  caffeine: boolean | null;
  dairy: boolean | null;
  components: { name: string; unit: 'g' | 'ml' | 'unit'; quantity: number }[];
}
