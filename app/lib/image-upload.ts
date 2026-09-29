import {
  STOCK_DOCUMENT_TYPES,
  type StockDocument,
} from "./stock-documents";

export const STOCK_IMAGE_ACCEPT = "image/*,.heic,.heif";
export const STOCK_IMAGE_INPUT_MAX_BYTES = 30 * 1024 * 1024;
// Sites accepts a bounded request body. Keeping each optional MEZANA image at
// 1 MB lets two photos and their multipart metadata fit in one mobile upload.
export const STOCK_IMAGE_MOBILE_SAFE_BYTES = 1 * 1024 * 1024;

export type PreparedStockImage = {
  file: File;
  optimized: boolean;
  originalSize: number;
};

const heicFile = (file: File) => (
  /\.(?:heic|heif)$/i.test(file.name)
  || file.type === "image/heic"
  || file.type === "image/heif"
);

const standardStockImage = (file: File) => (
  STOCK_DOCUMENT_TYPES.includes(file.type as StockDocument["contentType"])
);

const jpegName = (name: string) => {
  const base = name.replace(/\.[^.]+$/, "").trim() || "rasm";
  return `${base.slice(0, 170)}.jpg`;
};

async function convertHeic(file: File) {
  try {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob?.size) throw new Error("HEIC rasm bo‘sh qaytdi.");
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    throw new Error("HEIC rasm ochilmadi. Rasmni JPG qilib qayta tanlang yoki telefon kamerasida ‘Most Compatible’ formatini yoqing.");
  }
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Rasm ochilmadi."));
      image.src = url;
    });
  } finally {
    // The decoded image remains usable after revoking the source URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const canvasBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Rasm siqilmadi.")), "image/jpeg", quality);
});

async function compressToUploadLimit(file: File) {
  const image = await loadImage(file);
  let maxSide = 2_560;
  let quality = 0.88;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Rasm tayyorlanmadi.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, quality);
    if (blob.size <= STOCK_IMAGE_MOBILE_SAFE_BYTES) {
      return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
    }
    maxSide = Math.max(1_200, Math.round(maxSide * 0.78));
    quality = Math.max(0.58, quality - 0.09);
  }
  throw new Error("Rasm juda katta. Boshqa rasmni tanlang.");
}

export async function prepareStockImageUpload(file: File): Promise<PreparedStockImage> {
  if (!file.size) throw new Error("Tanlangan rasm bo‘sh.");
  if (file.size > STOCK_IMAGE_INPUT_MAX_BYTES) {
    throw new Error("Rasm 30 MB dan katta. Kichikroq rasmni tanlang.");
  }
  if (!file.type.startsWith("image/") && !heicFile(file)) {
    throw new Error("Faqat rasm faylini tanlang.");
  }
  if (standardStockImage(file) && file.size <= STOCK_IMAGE_MOBILE_SAFE_BYTES) {
    return { file, optimized: false, originalSize: file.size };
  }
  const standardFile = heicFile(file) ? await convertHeic(file) : file;
  const prepared = standardFile.size <= STOCK_IMAGE_MOBILE_SAFE_BYTES && standardStockImage(standardFile)
    ? standardFile
    : await compressToUploadLimit(standardFile);
  return { file: prepared, optimized: true, originalSize: file.size };
}

export function preparedImageNotice(value: PreparedStockImage) {
  if (!value.optimized) return "✓ Rasm qabul qilindi.";
  const megabytes = (value.file.size / 1024 / 1024).toFixed(1);
  return `✓ Rasm avtomatik JPG formatiga tayyorlandi · ${megabytes} MB.`;
}
