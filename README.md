# WebP 播放器（网页版 / PWA）

把桌面版 WebP 播放器移植为**网页版 / PWA**，可直接在 **iPhone Safari** 上使用，无需安装任何 App、无需 Apple 开发者账号。

## 功能

- 从 iPhone「文件」App **多选** WebP 图片
- 流畅播放**动画 WebP**（浏览器原生解码，最流畅）
- 播放 / 暂停 / 上一张 / 下一张
- 缩略图条快速切换（虚拟化渲染，支持大量图片）
- 支持添加到主屏幕，**离线可用**（Service Worker）

## 技术栈

- React 18 + Webpack 5（`target: 'web'`，纯浏览器）
- 主图播放：`<img src=blobUrl>` 原生解码
- 缩略图 / 探测：WebCodecs `ImageDecoder`（iOS 16.4+，低版本自动降级）

## 目录结构

```
webp-player-web/
├── package.json            # 依赖与构建脚本
├── webpack.config.js       # webpack 配置（target: 'web'）
├── public/
│   ├── index.html          # PWA / iOS meta 标签
│   ├── manifest.json       # PWA 清单
│   ├── sw.js               # Service Worker 离线缓存
│   └── icons/              # App 图标
└── src/
    ├── index.jsx           # React 入口 + SW 注册
    ├── App.jsx             # 文件选择（File 对象）
    ├── styles.css          # 样式（含 iOS 安全区优化）
    ├── components/
    │   ├── Player.jsx      # 主播放器
    │   └── ThumbnailStrip.jsx # 缩略图条
    └── utils/
        ├── webpDecoder.js  # WebCodecs 解码器
        ├── thumbnailGenerator.js # 缩略图生成
        └── iosCompat.js    # iOS 能力检测 / 降级
```

## 本地运行（开发）

```bash
npm install
npm run dev     # 打开 http://localhost:8080
```

## 构建产物

```bash
npm run build   # 输出到 dist/
npm run preview # 本地静态服务器预览
```

部署时把 `dist/` 目录里的所有文件放到任意**静态 HTTPS 服务器**即可。

## iPhone 使用说明

1. 把 `dist/` 部署到静态服务器（如 Vercel、Netlify、GitHub Pages 等），获得一个 HTTPS 网址
2. iPhone 用 **Safari** 打开该网址
3. 点「选择图片」→ 弹出 iPhone「文件」App → 多选 WebP 图片 → 开始播放
4. 点 Safari 底部「分享」按钮 → 「添加到主屏幕」→ 生成全屏独立 App，**离线也能用**

## 兼容性说明

| 功能 | iOS 16.4+ | iOS 16.4 以下 |
|------|-----------|---------------|
| 主图动画播放 | ✅ 流畅 | ✅ 流畅 |
| 缩略图（静态首帧） | ✅ 高效 | ⚠️ 降级为直接显示原图 |
| 暂停静态帧 | ✅ | ⚠️ 有限支持 |

> 建议升级到 iOS 16.4+ 以获得最佳体验（自动使用 `ImageDecoder`）。
