/** How wide a crest is stored. Big enough for a card, small enough for a row. */
export const CREST_PX = 256;

/**
 * Squares and shrinks a picture in the browser, before it is ever uploaded.
 *
 * People will pick a photograph off their phone — four thousand pixels wide
 * and three megabytes — for something drawn at thirty. Resizing here rather
 * than on the server means the big file never leaves the machine it is on,
 * there is no image library on the server to keep patched, and what arrives is
 * already the shape the circle wants.
 *
 * The crop is centred, which is what people expect when they hand over a
 * picture and see a circle.
 */
export async function squareImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file is not an image the browser can read"));
      img.src = url;
    });

    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("That image has no size");

    const canvas = document.createElement("canvas");
    canvas.width = CREST_PX;
    canvas.height = CREST_PX;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot resize the picture");

    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      CREST_PX,
      CREST_PX,
    );

    // WebP where it is supported, which is everywhere current, and a third the
    // size of the PNG. toDataURL falls back to PNG on its own if it is not.
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
