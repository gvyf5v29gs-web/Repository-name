import React, { useEffect, useRef, useState } from 'react';
import { generateStaticImage, hasImageDecoder } from '../utils/iosCompat';
import { getCachedThumb, releaseThumb } from '../utils/thumbnailGenerator';

const ITEM_WIDTH = 72;   // 缩略图宽度
const ITEM_GAP = 8;      // 间距 (对应 CSS margin-right)
const PAD = ITEM_WIDTH + ITEM_GAP;
const OVERSCAN = 5;      // 视口外预渲染数量

/**
 * 单个缩略图：优先用 ImageDecoder 解码首帧生成静态小图（iOS 16.4+）
 * 否则降级为直接把原文件 <img> 显示（显示首帧/动画）
 */
function ThumbCell({ file, active, index, onClick }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const fileName = file ? file.name : `#${index}`;

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setSrc(null);
    setLoading(true);

    async function loadThumb() {
      try {
        // 优先使用带缓存的缩略图获取（同一文件不重复解码）
        if (hasImageDecoder()) {
          objectUrl = await getCachedThumb(file, 128);
        } else {
          const buf = new Uint8Array(await file.arrayBuffer());
          objectUrl = await generateStaticImage(buf.buffer, 128);
        }
        if (!cancelled) {
          setSrc(objectUrl);
          setLoading(false);
        }
      } catch (err) {
        // 解码失败：显示占位
        if (!cancelled) setLoading(false);
      }
    }

    loadThumb();

    return () => {
      cancelled = true;
      // 组件卸载时释放该文件的缩略图缓存（回收内存）
      releaseThumb(file);
    };
  }, [file]);

  return (
    <div
      className={`thumb-item ${active ? 'active' : ''}`}
      onClick={() => onClick(index)}
      title={fileName}
    >
      {loading ? (
        <div className="thumb-loading" />
      ) : (
        <img src={src} alt="" decoding="async" />
      )}
      <span className="thumb-index">{index + 1}</span>
    </div>
  );
}

/**
 * 缩略图条：虚拟化渲染 + 静态首帧缩略图
 * 只渲染可视区域附近的缩略图，避免一次性加载 300+ 张 WebP
 */
export default function ThumbnailStrip({ files, currentIndex, onSelect }) {
  const stripRef = useRef(null);
  const itemRefs = useRef([]);
  const [scrollPos, setScrollPos] = useState(0);
  const [viewWidth, setViewWidth] = useState(0);

  const totalCount = files.length;
  const startIndex = Math.max(0, Math.floor(scrollPos / PAD) - OVERSCAN);
  const endIndex = Math.min(
    totalCount,
    Math.ceil((scrollPos + viewWidth) / PAD) + OVERSCAN,
  );

  // 当前项滚动到可见区域
  useEffect(() => {
    const el = itemRefs.current[currentIndex];
    if (el && stripRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentIndex]);

  // 监听容器宽度
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const updateWidth = () => setViewWidth(el.clientWidth);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const handleScroll = (e) => {
    setScrollPos(e.target.scrollLeft);
  };

  // 可视区内的缩略图 + 前后占位，保持滚动位置稳定
  const items = [];
  items.push(
    <div key="pad-start" style={{ width: startIndex * PAD, height: 1, flexShrink: 0 }} />,
  );
  for (let i = startIndex; i < endIndex; i++) {
    const file = files[i];
    const key = file ? file.name : `idx-${i}`;
    items.push(
      <div
        key={key}
        ref={(el) => (itemRefs.current[i] = el)}
      >
        <ThumbCell
          file={file}
          index={i}
          active={i === currentIndex}
          onClick={onSelect}
        />
      </div>,
    );
  }
  items.push(
    <div
      key="pad-end"
      style={{ width: Math.max(0, (totalCount - endIndex)) * PAD, height: 1, flexShrink: 0 }}
    />,
  );

  return (
    <div className="thumb-strip" ref={stripRef} onScroll={handleScroll}>
      {items}
    </div>
  );
}
