/**
 * iOS 兼容性检测
 * 关键差异：ImageDecoder (WebCodecs API) 在 iOS Safari 16.4+ 才可用，
 * 更早版本需要用 <img> 直接加载兜底。
 */

/** 是否支持 WebCodecs ImageDecoder（用于生成静态首帧/缩略图/探测） */
export function hasImageDecoder() {
  return typeof ImageDecoder !== 'undefined';
}

/** 当前是否 iOS Safari */
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * 生成静态首帧缩略图的兼容封装：
 *  - 支持 ImageDecoder：解码首帧 -> canvas -> 小图 blob URL
 *  - 不支持：直接把整个 WebP 转成 blob URL 交给 <img>（动画则显示首帧）
 * @param {ArrayBuffer} arrayBuffer WebP 文件数据
 * @param {number} size 目标宽度
 * @returns {Promise<string>} blob URL
 */
export async function generateStaticImage(arrayBuffer, size = 128) {
  if (hasImageDecoder()) {
    const { generateThumbFromBuffer } = await import('./thumbnailGenerator');
    return generateThumbFromBuffer(arrayBuffer, size);
  }
  // 降级：直接把原文件作为 <img> 使用（动画 WebP 会播放，但缩略图容器可裁剪为静态观感）
  const blob = new Blob([arrayBuffer], { type: 'image/webp' });
  return URL.createObjectURL(blob);
}
