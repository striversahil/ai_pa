

// Pieces split into ./service-parts/ (importable on their own); re-exported for compat.
export { getProductLineData, invalidateProductLineCache, getProductIndex, invalidateProductIndex, getRatesForProduct, invalidateProductRatesCache, getRateById, getVendorIndex, invalidateVendorIndex, countRatesForVendor, countActiveRatesForVendor, getProductDetail, invalidateProductDetailCache } from "./service-parts/io";
export type { ProductIndexRow, VendorIndexRow } from "./service-parts/types";


