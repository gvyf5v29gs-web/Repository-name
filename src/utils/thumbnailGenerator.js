/**
 * 纯前端缩略图生成：用 ImageDecoder 解码 WebP 首帧，缩放到小尺寸静态图
 * 避免用动画 WebP 作为 <img> 导致持续解码动画
 *
 * 优化：增加结果缓存（按文件引用缓存 blob URL），避免同一文件重复解码。
 * 十几 MB 的大文件首次解码仍会占用内存，但缓存后再次展示缩略图几乎零成本。
 */

// 缓存：key 为 File 对象引用，value 为 { url, promise }
const _thumbCache = new WeakMap();

/**
 * 解码 WebP 首帧并生成缩略图 blob URL
 * @param {ArrayBuffer} arrayBuffer WebP 文件数据
 * @param {number} size 目标宽度（高度按比例）
 * @returns {Promise<string>} blob URL
 */
export async function generateThumbFromBuffer(arrayBuffer, size = 128) {
  const decoder = new ImageDecoder({
    data: arrayBuffer,
    type: 'image/webp',
  });
  await decoder.tracks.ready;

  // 解码首帧
  const { image } = await decoder.decode({ frameIndex: 0 });

  // 缩小到目标尺寸
  const scale = Math.min(1, size / image.displayWidth);
  const targetW = Math.round(image.displayWidth * scale);
  const targetH = Math.round(image.displayHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, targetW, targetH);
  image.close();
  decoder.close();

  // 转成 blob URL
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });

  return URL.createObjectURL(blob);
}

/**
 * 带缓存的缩略图获取：优先返回缓存的 blob URL。
 * @param {File} file File 对象
 * @param {number} size 目标宽度
 * @returns {Promise<string>} blob URL
 */
export function getCachedThumb(file, size = 128) {
  let entry = _thumbCache.get(file);
  if (entry && !entry.dead) {
    return entry.promise;
  }

  const promise = (async () => {
    const buf = new Uint8Array(await file.arrayBuffer());
    return generateThumbFromBuffer(buf.buffer, size);
  })();

  entry = { url: null, promise, dead: false };
  entry.promise = entry.promise.then((url) => {
    // 释放上一个 URL
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = url;
    return url;
  });
  _thumbCache.set(file, entry);
  return entry.promise;
}

/**
 * 从缓存中移除指定文件的缩略图（释放内存）
 * @param {File} file
 */
export function releaseThumb(file) {
  const entry = _thumbCache.get(file);
  if (entry) {
    entry.dead = true;
    if (entry.url) URL.revokeObjectURL(entry.url);
    _thumbCache.delete(file);
  }
}
