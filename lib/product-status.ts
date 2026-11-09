/**
 * Release stage for every Verafy product, in one place.
 * The shared product header reads this to draw the Alpha / Beta pill next to the logo.
 * The verafy.ai home page and Perspective keep a matching copy (separate repos).
 */
export type ProductStage = "alpha" | "beta";

export const PRODUCT_STAGE = {
  "bias-detector": "alpha",
  "swarm-explorer": "beta",
  perspective: "beta",
  predict: "beta", // Verafy Forecast
  mediation: "alpha", // Verafy Judiciary
  inspector: "alpha",
  fuzzy: "alpha",
} as const satisfies Record<string, ProductStage>;

export type StagedProduct = keyof typeof PRODUCT_STAGE;

export const STAGE_LABEL: Record<ProductStage, string> = {
  alpha: "Alpha",
  beta: "Beta",
};

export function productStage(product: string): ProductStage | undefined {
  return (PRODUCT_STAGE as Record<string, ProductStage>)[product];
}
