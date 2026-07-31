import React, {
  useState, useEffect, useRef, forwardRef,
  useImperativeHandle,
} from 'react';
import { WebPPlayer } from '../utils/webpDecoder';
import { generateStaticImage, hasImageDecoder } from '../utils/iosCompat';
import { getCachedThumb, releaseThumb } from '../utils/thumbnailGenerator';

/**
 * 主播放区：使用 blob: URL 加载 WebP，保证切换图片绝对可靠
 *
 * 为什么用 blob: URL：
 *  - <img src=blobUrl> 由浏览器原生解码播放动画 WebP，最流畅、GPU 加速
 *  - blob: URL 基于内存数据，完全可控，配合 key 强制重建 <img> 节点，切换即用
 *
 * 加载流程：
 *  1. file.arrayBuffer() 读取二进制（File 对象）
 *  2. new Blob([buf], {type:'image/webp'}) -> URL.createObjectURL() -> blob: URL
 *  3. <img src={blobUrl}>，Safari 原生解码播放动画 WebP
 */
const Player = forwardRef(function Player({ file, onPrev, onNext }, ref) {
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const playerInstRef = useRef(null); // WebPPlayer 实例
  const pauseThumbUrlRef = useRef(null); // 跟踪暂停图 blob URL，便于释放
  const [isPlaying, setIsPlaying] = useState(true);
  const [paused, setPaused] = useState(false);
  const [pauseThumb, setPauseThumb] = useState(null);
  const [smoothMode, setSmoothMode] = useState(false); // 流畅模式（降分辨率）
  const [info, setInfo] = useState(null);        // 尺寸信息
  const [isAnimation, setIsAnimation] = useState(null); // null=检测中, true/false
  const [fileMeta, setFileMeta] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [imgSrc, setImgSrc] = useState(null);    // blob URL

  // 释放暂停图 blob URL（避免内存泄漏）
  const revokePauseThumb = () => {
    if (pauseThumbUrlRef.current) {
      URL.revokeObjectURL(pauseThumbUrlRef.current);
      pauseThumbUrlRef.current = null;
    }
  };

  // 停止并销毁 canvas 播放器实例
  const stopCanvasPlayer = () => {
    if (playerInstRef.current) {
      playerInstRef.current.destroy();
      playerInstRef.current = null;
    }
  };

  // 用 WebPPlayer 在 canvas 上降分辨率播放
  const startCanvasPlayer = async (arrayBuffer, scaleMode) => {
    if (cancelledRef.current) return;
    stopCanvasPlayer();
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 初始化 canvas 尺寸为默认显示区域，避免黑屏
    canvas.width = 1;
    canvas.height = 1;

    try {
      const inst = new WebPPlayer(canvas, {
        onPlayStateChange: (playing) => {
          if (!cancelledRef.current) {
            setPaused(!playing);
            setIsPlaying(playing);
          }
        },
      });
      inst.setScaleMode(scaleMode);
      playerInstRef.current = inst;
      const info = await inst.load(arrayBuffer);
      if (cancelledRef.current) return;
      // 加载成功后确保 canvas 有正确尺寸
      if (info) {
        setInfo(info);
        setIsAnimation(info.isAnimation);
      }
    } catch (err) {
      console.error('[Player] canvas 播放失败:', err);
      if (!cancelledRef.current) {
        // canvas 播放失败：自动回退到原画模式（<img>），保证用户始终能看到图片而非黑屏
        setSmoothMode(false);
        setLoadError('流畅模式不可用，已回退到原画模式');
      }
    }
  };

  // 取消标记（ref 形式，供异步回调共享）
  const cancelledRef = useRef(false);

  // 加载文件（读取二进制 -> 生成 blob URL）
  useEffect(() => {
    cancelledRef.current = false;
    let objectUrl = null;
    setLoadError(null);
    setInfo(null);
    setIsAnimation(null);
    setPaused(false);
    revokePauseThumb();
    setPauseThumb(null);
    setIsPlaying(true);
    setImgSrc(null);

    async function load() {
      if (!file) return;
      const cancelled = () => cancelledRef.current;

      // 文件信息（File 对象自带 name/size）
      if (!cancelled()) setFileMeta({ name: file.name, size: file.size });

      try {
        // 读取文件二进制
        const buf = new Uint8Array(await file.arrayBuffer());
        console.log('[Player-load] 读取成功, byteLength=', buf.byteLength);

        // 探测尺寸/动画信息（需要 ImageDecoder）
        if (hasImageDecoder()) {
          try {
            const probeInfo = await WebPPlayer.probe(buf.buffer);
            if (!cancelled()) {
              setInfo(probeInfo);
              setIsAnimation(probeInfo.isAnimation);
            }
            console.log('[Player-load] 探测成功', JSON.stringify(probeInfo));
          } catch (err) {
            if (!cancelled()) console.error('[Player] 探测信息失败:', err);
          }
          if (cancelled()) return;
        } else {
          // 无 ImageDecoder：无法探测，默认按动画处理（<img> 自动播放）
          if (!cancelled()) setIsAnimation(true);
        }

        if (smoothMode) {
          // 流畅模式：用 canvas + WebPPlayer 降分辨率播放
          // canvas 由渲染逻辑决定是否显示；若未挂载，则等渲染后的 effect 启动
          if (canvasRef.current) {
            await startCanvasPlayer(buf.buffer, smoothMode);
          }
        } else {
          // 原始模式：生成 blob URL 用于 <img> 加载（浏览器原生解码）
          const blob = new Blob([buf.buffer], { type: 'image/webp' });
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled()) setImgSrc(objectUrl);
          console.log('[Player-load] blob URL 生成:', objectUrl);
        }
      } catch (err) {
        if (!cancelled()) setLoadError(err.message || '读取文件失败');
      }
    }

    load();

    return () => {
      cancelledRef.current = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      stopCanvasPlayer();
      revokePauseThumb();
      // 释放该文件的缩略图缓存（回收内存）
      releaseThumb(file);
    };
  }, [file, smoothMode]);

  // 播放/暂停（原生 <img> 无法暂停动画，用静态首帧图盖住模拟暂停）
  const handleTogglePlay = () => {
    if (!isAnimation) return;
    // 流畅模式：直接用 WebPPlayer 实例控制暂停/播放
    if (smoothMode) {
      if (playerInstRef.current) {
        playerInstRef.current.toggle();
      }
      return;
    }
    const img = imgRef.current;
    if (paused) {
      if (img) img.style.visibility = 'visible';
      setPaused(false);
      setIsPlaying(true);
    } else {
      // 暂停：生成静态首帧图盖住动画
      // 优先用缓存的缩略图（已解码首帧，避免重复读取十几 MB 大文件）
      const loadPause = async () => {
        if (!file) return;
        try {
          revokePauseThumb(); // 先释放旧的暂停图
          let url;
          if (hasImageDecoder()) {
            url = await getCachedThumb(file, 1024);
          } else {
            const buf = new Uint8Array(await file.arrayBuffer());
            url = await generateStaticImage(buf.buffer, 1024);
          }
          pauseThumbUrlRef.current = url;
          setPauseThumb(url);
        } catch (e) {
          console.error('[Player] 生成暂停图失败:', e);
        }
      };
      loadPause();
      if (img) img.style.visibility = 'hidden';
      setPaused(true);
      setIsPlaying(false);
    }
  };

  // 暴露给父组件（快捷键用）
  useImperativeHandle(ref, () => ({
    togglePlay: () => handleTogglePlay(),
    stepFrame: () => {},
  }));

  // 格式化文件大小
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const frameRate = info && info.frameDurationMs > 0
    ? Math.round(1000 / info.frameDurationMs)
    : 0;

  const fileName = file ? file.name : '';

  return (
    <div className="player-wrap">
      {/* 播放控制条 */}
      <div className="player-toolbar">
        <div className="ctrl-group">
          <button className="icon-btn" onClick={onPrev} title="上一张">
            ⏮
          </button>
          <button
            className="icon-btn primary-ctrl"
            onClick={handleTogglePlay}
            disabled={!isAnimation}
            title={isAnimation ? '播放/暂停' : '静态图不可播放'}
          >
            {isAnimation && !paused ? '⏸' : '▶'}
          </button>
          <button className="icon-btn" onClick={onNext} title="下一张">
            ⏭
          </button>
        </div>
        {/* 流畅模式切换：大文件卡顿时降分辨率播放 */}
        <div className="smooth-toggle">
          <button
            className={`smooth-btn ${smoothMode ? 'active' : ''}`}
            onClick={() => setSmoothMode((m) => !m)}
            title="流畅模式：降低播放分辨率，缓解大文件卡顿"
          >
            {smoothMode ? '🔉 流畅' : '🔊 原画'}
          </button>
        </div>
      </div>

      {/* 显示区域 */}
      <div className="player-stage">
        {loadError && (
          <div className="load-error">
            <p>❌ 加载失败</p>
            <p className="err-msg">{loadError}</p>
          </div>
        )}

        {!file && <div className="empty-state"><p>请选择图片</p></div>}

        {/* 流畅模式：canvas 降分辨率播放 */}
        {file && smoothMode && (
          <div className="player-img-wrap" key={fileName}>
            <canvas ref={canvasRef} className="player-canvas" />
          </div>
        )}

        {/* 原始模式：blob URL + 浏览器原生播放动画 WebP */}
        {file && !smoothMode && imgSrc && (
          <div className="player-img-wrap" key={fileName}>
            <img
              key={`main-${fileName}`}
              ref={imgRef}
              className="player-img"
              src={imgSrc}
              alt="webp"
              decoding="sync"
              loading="eager"
            />
            {/* 暂停时盖一层静态首帧图 */}
            {paused && pauseThumb && (
              <img
                key={`pause-${fileName}`}
                className="player-img player-img-pause"
                src={pauseThumb}
                alt=""
                decoding="sync"
              />
            )}
          </div>
        )}

        {/* 加载中占位 */}
        {file && !smoothMode && !imgSrc && !loadError && (
          <div className="empty-state"><p>加载中...</p></div>
        )}
      </div>

      {/* 信息栏 */}
      <div className="info-bar">
        <span className="file-name" title={fileName}>
          {fileName}
        </span>
        {info && (
          <span className="file-dims">{info.width} × {info.height}</span>
        )}
        {isAnimation === true && (
          <span className="badge anim-badge">动画</span>
        )}
        {isAnimation === true && frameRate > 0 && (
          <span className="file-dims">{frameRate} fps</span>
        )}
        <span className="spacer" />
        {fileMeta && (
          <span className="file-size">{formatSize(fileMeta.size)}</span>
        )}
      </div>
    </div>
  );
});

export default Player;
