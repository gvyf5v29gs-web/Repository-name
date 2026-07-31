/**
 * WebP 动画解码播放器
 * 基于 WebCodecs ImageDecoder，实现帧级控制：播放/暂停/倍速/逐帧/循环
 */
export class WebPPlayer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.decoder = null;
    this.track = null;
    this.buffer = null;

    // 播放状态
    this.isPlaying = false;
    this.currentFrame = 0;
    this.playbackRate = 1.0;
    this.loop = true;
    this.isAnimation = false;
    this.frameCount = 0;
    this.frameDuration = 0; // 单帧时长(ms)
    this.repeatedTimes = 0; // 循环次数 (0 = 无限)
    this.renderedCount = 0;
    this.scaleMode = false;  // 是否降分辨率（流畅模式）
    this.maxPixels = 1000 * 1400; // 流畅模式目标像素上限（约 140 万像素）

    this._rafId = null;
    this._lastTime = 0;
    this._preloadCache = new Map(); // 预解码缓存
    this._decoding = new Set();     // 正在解码的帧

    this.onPlayStateChange = options.onPlayStateChange || null;
    this.onFrameChange = options.onFrameChange || null;
    this.onInfoChange = options.onInfoChange || null;
  }

  /**
   * 加载 WebP 文件 (ArrayBuffer)
   * 返回文件信息，成功则自动播放
   */
  async load(arrayBuffer) {
    this.stop();
    this.buffer = arrayBuffer;

    try {
      // 分两步创建解码器：先读原始尺寸，若开启缩放且过大，用 desiredWidth/Height 重新创建以直接解码低分辨率
      this.decoder = new ImageDecoder({ data: arrayBuffer, type: 'image/webp' });
      await this.decoder.tracks.ready;
      this.track = this.decoder.tracks.selectedTrack;

      const info = {
        width: this.track.displayWidth || this.track.canvasWidth,
        height: this.track.displayHeight || this.track.canvasHeight,
        frameCount: this.track.frameCount,
        frameDurationMs: this.track.frameDuration ? this.track.frameDuration / 1000 : 0,
        repeatedTimes: this.track.repeatedTimes,
      };

      this.frameCount = info.frameCount;
      this.frameDuration = info.frameDurationMs || 100; // 默认 100ms
      this.repeatedTimes = info.repeatedTimes;
      this.isAnimation = info.frameCount > 1;
      this.currentFrame = 0;
      this.renderedCount = 0;

      // 计算渲染尺寸（支持降分辨率）
      this.srcWidth = info.width;
      this.srcHeight = info.height;
      this.setScaleMode(this.scaleMode);

      // 设置 canvas 尺寸
      this.canvas.width = this.renderWidth;
      this.canvas.height = this.renderHeight;

      // 解码第一帧立即显示
      await this.decodeAndDraw(0);

      if (this.onInfoChange) this.onInfoChange(info);
      if (this.onFrameChange) this.onFrameChange(0, info.frameCount);

      // 动画则自动播放
      if (this.isAnimation) {
        this.play();
      } else {
        if (this.onPlayStateChange) this.onPlayStateChange(false, true);
      }

      return info;
    } catch (err) {
      console.error('[WebPPlayer] 加载失败:', err);
      throw err;
    }
  }

  /**
   * 解析静态图信息（供静态 WebP 用 <img> 显示）
   */
  static async probe(arrayBuffer) {
    const decoder = new ImageDecoder({ data: arrayBuffer, type: 'image/webp' });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const info = {
      width: track.displayWidth || track.canvasWidth,
      height: track.displayHeight || track.canvasHeight,
      frameCount: track.frameCount,
      frameDurationMs: track.frameDuration ? track.frameDuration / 1000 : 0,
      repeatedTimes: track.repeatedTimes,
      isAnimation: track.frameCount > 1,
    };
    decoder.close();
    return info;
  }

  /**
   * 设置是否降分辨率（流畅模式）
   * @param {boolean} enabled
   */
  setScaleMode(enabled) {
    this.scaleMode = !!enabled;
    if (!this.srcWidth) return;
    if (this.scaleMode) {
      // 计算缩放：保持比例，使总像素不超过 maxPixels
      const total = this.srcWidth * this.srcHeight;
      const scale = Math.min(1, Math.sqrt(this.maxPixels / total));
      this.renderWidth = Math.max(1, Math.round(this.srcWidth * scale));
      this.renderHeight = Math.max(1, Math.round(this.srcHeight * scale));
    } else {
      this.renderWidth = this.srcWidth;
      this.renderHeight = this.srcHeight;
    }
    // 更新 canvas 尺寸
    this.canvas.width = this.renderWidth;
    this.canvas.height = this.renderHeight;
  }

  /* ==================== 播放控制 ==================== */

  play() {
    if (!this.isAnimation || this.isPlaying) return;
    this.isPlaying = true;
    this._lastTime = 0;
    this._renderLoop();
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  stop() {
    this.pause();
    this._preloadCache.clear();
    this._decoding.clear();
    if (this.decoder) {
      try { this.decoder.close(); } catch (e) {}
      this.decoder = null;
    }
    this.track = null;
    this.isAnimation = false;
    this.currentFrame = 0;
  }

  setPlaybackRate(rate) {
    this.playbackRate = Math.max(0.1, Math.min(4, rate));
    if (this.isPlaying) {
      // 重置计时基准
      this._lastTime = 0;
    }
  }

  setLoop(loop) {
    this.loop = loop;
  }

  /**
   * 逐帧跳转
   */
  async step(delta) {
    this.pause();
    const next = this.currentFrame + delta;
    if (next < 0) {
      this.currentFrame = this.frameCount - 1;
    } else if (next >= this.frameCount) {
      this.currentFrame = 0;
    } else {
      this.currentFrame = next;
    }
    await this.decodeAndDraw(this.currentFrame);
    if (this.onFrameChange) this.onFrameChange(this.currentFrame, this.frameCount);
  }

  /**
   * 跳转到指定帧
   */
  async seek(frameIndex) {
    if (frameIndex < 0 || frameIndex >= this.frameCount) return;
    this.pause();
    this.currentFrame = frameIndex;
    this.renderedCount = 0;
    await this.decodeAndDraw(this.currentFrame);
    if (this.onFrameChange) this.onFrameChange(this.currentFrame, this.frameCount);
  }

  /* ==================== 渲染 ==================== */

  _renderLoop = () => {
    if (!this.isPlaying) return;

    this._rafId = requestAnimationFrame(this._renderLoop);

    const now = performance.now();
    if (this._lastTime === 0) {
      this._lastTime = now;
      return;
    }

    const elapsed = now - this._lastTime;
    const frameInterval = this.frameDuration / this.playbackRate;

    if (elapsed >= frameInterval) {
      this._lastTime = now;
      this._nextFrame();
    }
  };

  _nextFrame() {
    let next = this.currentFrame + 1;

    if (next >= this.frameCount) {
      this.renderedCount++;
      if (this.repeatedTimes > 0 && this.renderedCount >= this.repeatedTimes) {
        // 播放完毕，停在最后一帧
        this.currentFrame = this.frameCount - 1;
        this.decodeAndDraw(this.currentFrame);
        this.pause();
        return;
      }
      if (!this.loop) {
        this.currentFrame = this.frameCount - 1;
        this.decodeAndDraw(this.currentFrame);
        this.pause();
        return;
      }
      next = 0;
    }

    this.currentFrame = next;
    this.decodeAndDraw(next);
    if (this.onFrameChange) this.onFrameChange(next, this.frameCount);
  }

  /**
   * 解码并绘制指定帧（带预解码缓存）
   */
  async decodeAndDraw(frameIndex) {
    if (this._decoding.has(frameIndex)) return; // 已在解码

    this._decoding.add(frameIndex);
    try {
      const result = await this.decoder.decode({ frameIndex });
      this._decoding.delete(frameIndex);
      if (result.image) {
        await this._drawFrame(result.image);
        if (result.image && typeof result.image.close === 'function') result.image.close();
      }
    } catch (err) {
      this._decoding.delete(frameIndex);
      console.error('[WebPPlayer] 解码帧失败:', frameIndex, err);
    }
  }

  /**
   * 预解码缓存帧（限制最多 3 帧）
   */
  _preload(frameIndex) {
    if (frameIndex >= this.frameCount || this._decoding.has(frameIndex)) return;
    if (this._preloadCache.size >= 3) return;

    this.decoder.decode({ frameIndex }).then((result) => {
      if (this._preloadCache.size >= 3) {
        result.image.close();
        return;
      }
      this._preloadCache.set(frameIndex, result.image);
    }).catch(() => {});
  }

  async _drawFrame(image) {
    if (!image) return;
    const sw = image.displayWidth || image.codedWidth || image.width;
    const sh = image.displayHeight || image.codedHeight || image.height;
    if (!sw || !sh) return;

    // 与缩略图(已验可用)一致：直接 drawImage(VideoFrame) 缩放绘制
    // 先尝试 drawImage，失败再用 createImageBitmap 兜底
    try {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(
        image, 0, 0, sw, sh,
        0, 0, this.canvas.width, this.canvas.height
      );
      return;
    } catch (e) {
      console.warn('[WebPPlayer] drawImage(VideoFrame) 失败，尝试 createImageBitmap:', e);
    }

    // 兜底：createImageBitmap
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(image);
        const bw = bitmap.width;
        const bh = bitmap.height;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(
          bitmap, 0, 0, bw, bh,
          0, 0, this.canvas.width, this.canvas.height
        );
        bitmap.close();
      } catch (e2) {
        console.error('[WebPPlayer] createImageBitmap 绘制也失败:', e2);
      }
    }
  }

  destroy() {
    this.stop();
    this.ctx = null;
    this.canvas = null;
  }
}
