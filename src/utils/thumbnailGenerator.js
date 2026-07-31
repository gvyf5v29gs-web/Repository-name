/**
 * 纯前端缩略图生成：用 ImageDecoder 解码 WebP 首帧，缩放到小尺寸静态图
 * 避免用动画 WebP 作为 <img> 导致持续解码动画
 */

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
    // 只解码首帧，节省资源
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
