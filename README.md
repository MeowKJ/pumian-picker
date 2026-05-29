# 铺面拔取器

MajdataNet 近期谱面批量下载桌面工具。

## 功能

- 拉取 MajdataNet 近期谱面列表
- 按难度、关键词筛选
- 批量下载 `maidata.txt`、`track.mp3`、`bg.jpg`
- 可选尝试下载 `pv.mp4`
- 每个谱面保存到独立子文件夹
- 保存 `meta.json`，支持跳过已下载
- GitHub Actions 构建 Windows x64、macOS arm64、Linux x64

## 本地开发

```bash
pnpm install
pnpm dev
```

## 构建

```bash
pnpm dist:mac
pnpm dist:win
pnpm dist:linux
```

macOS 构建会让 electron-builder 自动发现可用的 code-signing identity。没有本机或 CI 证书时，会生成未签名包。
