/** Picked-file → PNG base64, shared by every panel that stages a reference
 * image (image lab, bible). The core only accepts PNG, and a 4K phone photo
 * would blow the 32 MB ceiling, so decode → downscale → re-encode here. */
export async function fileToPngBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
