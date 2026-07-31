import React, { useState, useCallback, useRef, useMemo } from 'react';
import Player from './components/Player';
import ThumbnailStrip from './components/ThumbnailStrip';

// 是否支持 WebCodecs ImageDecoder（iOS 16.4+）
const HAS_DECODER = typeof ImageDecoder !== 'undefined';

export default function App() {
  const [files, setFiles] = useState([]);         // 当前选择的 File 对象列表
  const [currentIndex, setCurrentIndex] = useState(0);
  const playerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 兼容：File 对象数组（元素为 File）
  const currentFile = files[currentIndex] || null;

  // 触发文件选择
  const handleOpenPicker = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  // <input type="file"> 变化：接收 File 对象数组，按文件名自然排序
  const handleFileChange = useCallback((e) => {
    const list = Array.from(e.target.files || []);
    if (list.length === 0) return;

    // 过滤并自然排序
    const webpFiles = list.filter(
      (f) => f.name.toLowerCase().endsWith('.webp') || f.type === 'image/webp'
    );

    if (webpFiles.length === 0) {
      alert('没有找到 WebP 图片');
      e.target.value = '';
      return;
    }

    // 按文件名自然排序（数字感知）
    webpFiles.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    setFiles(webpFiles);
    setCurrentIndex(0);
    // 允许再次选择相同文件
    e.target.value = '';
  }, []);

  const handlePrev = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : files.length - 1));
  }, [files.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % files.length);
  }, [files.length]);

  const currentName = useMemo(
    () => (currentFile ? currentFile.name : ''),
    [currentFile]
  );

  return (
    <div className="app">
      {/* 隐藏的文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".webp,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 顶部工具栏 */}
      <div className="toolbar">
        <div className="toolbar-left">
          <button className="btn primary" onClick={handleOpenPicker}>
            📁 选择图片
          </button>
        </div>
        <div className="toolbar-center">
          {files.length > 0 ? (
            <span className="folder-name" title={currentName}>
              🖼️ {currentName}
            </span>
          ) : (
            <span className="folder-name">从 iPhone「文件」App 选择图片</span>
          )}
        </div>
        <div className="toolbar-right">
          <span className="file-count">
            {files.length > 0 ? `${currentIndex + 1} / ${files.length}` : ''}
          </span>
        </div>
      </div>

      {/* 播放主体 */}
      <div className="main-area">
        {currentFile ? (
          <Player
            ref={playerRef}
            file={currentFile}
            onPrev={handlePrev}
            onNext={handleNext}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🖼️</div>
            <h2>WebP 播放器</h2>
            <p>从 iPhone「文件」App 多选图片，流畅播放动画 / 静态 WebP</p>
            {!HAS_DECODER && (
              <p className="hint-dim">
                当前系统较旧，缩略图模式受限（iOS 16.4+ 体验最佳）
              </p>
            )}
            <div className="empty-actions">
              <button className="btn primary large" onClick={handleOpenPicker}>
                选择图片
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 缩略图条 */}
      {files.length > 0 && (
        <ThumbnailStrip
          files={files}
          currentIndex={currentIndex}
          onSelect={setCurrentIndex}
        />
      )}
    </div>
  );
}
