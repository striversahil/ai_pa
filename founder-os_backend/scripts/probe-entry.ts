import { productLineIntakeDef } from '../src/automations/product-line/intake';
export async function run(ctx: any, action: any) {
  return productLineIntakeDef.executeProposal(ctx, action);
}
export { productLineIntakeDef };
