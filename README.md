# Shopify Asset Downloader

Shopify 主题模板素材批量下载工具。从 Shopify 主题模板中提取视频和图片资源，支持 `shopify://` 协议路径自动解析为 CDN 地址，单个或批量下载。

## 功能

- **主题浏览** — 连接 Shopify 店铺后自动拉取主题列表，支持切换不同主题
- **模板解析** — 选择模板后自动提取其中引用的所有视频和图片资源
- **`shopify://` 协议解析** — 通过 GraphQL / REST / CDN 探测三级策略，将 `shopify://` 路径解析为可下载的 CDN URL
- **NDJSON 流式解析** — 解析结果逐行推送，文件一个个点亮而非全部等待
- **批量下载** — 多文件自动打包为 ZIP，单文件直接下载，支持取消
- **图片推送** — 将图片资源推送到目标 Shopify 站点，支持多目标站点配置切换，已存在的文件自动跳过
- **元对象迁移** — 独立页面（顶栏导航进入）列出源站点全部元对象，勾选后迁移到目标站点，缺失的定义自动创建，引用字段跨店重映射
- **模板代码查看** — 弹窗查看模板 JSON 原文和引用的 Section 代码，支持复制和下载
- **素材预览** — 视频和图片在线预览，支持视频拖拽进度条
- **配置管理** — 源站点和目标站点 API 凭证分别保存，支持多配置切换

## 技术栈

- **Next.js 16** App Router + React 19
- **TypeScript** 严格模式
- **shadcn/ui** (base-nova 风格) + Tailwind CSS 4
- **JSZip** 客户端打包

## 项目结构

```
app/
  page.tsx                        # 主页面（全局状态 + 布局组装）
  config/page.tsx                 # 店铺配置页
  metafields/page.tsx             # 产品元字段迁移页面
  metaobjects/page.tsx            # 元对象迁移页面（独立全屏路由）
  api/
    shopify-resolve/route.ts      # shopify:// URL 解析（NDJSON 流式响应）
    shopify-templates/route.ts    # 主题/模板列表 & 内容获取
    shopify-videos/route.ts       # 文件下载（单文件 / ZIP）
    shopify-push/route.ts         # 图片/视频推送（NDJSON 流式响应）
    shopify-metaobjects/route.ts  # 元对象列表 & 迁移（NDJSON 流式）
    shopify-metafields/route.ts   # 元字段定义列表 & 迁移（NDJSON 流式）

components/
  step-template-picker.tsx        # Step 1: 主题 & 模板选择
  template-info.tsx               # 模板 JSON / Section 信息面板（合并进步骤 1）
  step-header.tsx                 # 步骤卡片共用头部
  step-download.tsx               # Step 2: 素材列表 & 下载 / 推送
  image-push-dialog.tsx           # 推送素材到目标站点（图片 / 视频）
  metaobject-migration.tsx        # 元对象迁移面板（/metaobjects 页面主体）
  metafield-migration.tsx         # 元字段迁移面板（/metafields 页面主体）
  app-sidebar.tsx                 # 侧边导航
  site-header.tsx                 # 顶栏（页面标题 + 店铺状态）
  error-banner.tsx                # 错误提示
  media-card.tsx                  # 素材卡片（视频/图片）
  preview-dialog.tsx              # 素材预览弹窗（支持左右切换）
  copy-url-button.tsx             # 复制 CDN 链接
  code-dialog.tsx                 # 代码查看弹窗
  icons.tsx                       # SVG 图标组件
  ui/                             # shadcn/ui 基础组件

lib/
  shopify.ts                      # Shopify Admin API 文件解析/查重核心逻辑
  metaobjects.ts                  # 元对象读取与跨店迁移核心逻辑
  metafields.ts                   # 元字段定义迁移核心逻辑
  stores.ts                       # 统一店铺列表 + 当前源/目标指针
  parse.ts                        # 模板 JSON 解析（提取媒体 URL & Section 引用）
  template.ts                     # 模板名称映射 & 工具函数
  filename.ts                     # 下载文件命名 / 扩展名对齐 / 重名去重
  stream.ts                       # 流式读取响应 + 字节进度
  ndjson.ts                       # NDJSON 流式读取
  concurrency.ts                  # 限制并发数
  types.ts                        # 共用类型定义
  utils.ts                        # cn() / formatBytes()
```

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建
npm run build && npm start
```

打开 `http://localhost:3000`，填写 Shopify 店铺域名和 Admin API Access Token，选择主题和模板即可开始。

## API 路由

| 路由                       | 方法 | 说明                                                        |
| -------------------------- | ---- | ----------------------------------------------------------- |
| `/api/shopify-templates`   | POST | `list-themes` / `list-templates` / `get-template`           |
| `/api/shopify-resolve`     | POST | 将 `shopify://` URL 批量解析为 CDN 地址（NDJSON 流式）      |
| `/api/shopify-videos`      | POST | 服务端代理下载（客户端 CORS 失败时回退）                    |
| `/api/shopify-push`        | POST | 将图片推送到目标 Shopify 站点（NDJSON 流式）                |
| `/api/shopify-metaobjects` | POST | `list` 元对象列表 / `migrate` 迁移到目标站点（NDJSON 流式） |

## 图片推送功能

配置目标站点后，可以将图片资源直接推送到另一个 Shopify 站点：

1. 在 **API 配置（Step 1）** 展开「目标站点」区域，填写域名和 Admin API Token 并保存
2. 支持保存多个目标站点配置，通过下拉切换
3. 在文件列表中选择要推送的图片
4. 点击 **Push** 按钮开始推送
5. 已存在的文件会自动跳过，推送结果实时显示

**上传策略**：

- 优先使用 `src` 模式（Shopify 从 URL 拉取），适用于 Shopify CDN 内部图片
- 若 `src` 模式失败（如外链图片），自动切换为**服务端下载后直传**模式

**权限要求**：目标站点的 Admin API Token 需要 `write_files` 权限。

## 元对象迁移功能

配置源站点与目标站点后，可以批量迁移元对象（Metaobject）：

1. 从顶栏导航进入 **元对象迁移** 页面，点击 **加载元对象**，拉取源站点全部元对象定义与条目
2. 条目按定义类型分组展示，勾选要迁移的条目（支持按组全选 / 全选）
3. 点击 **迁移所选** 开始迁移，结果逐条实时显示

**迁移策略**：

- 目标站点缺失的元对象定义（含字段结构）自动创建
- 目标站点已有同 handle 的条目自动跳过
- 引用字段跨店重映射：元对象引用按 type+handle 对齐，文件引用按文件名对齐
- 产品等其他跨店引用暂不迁移（跳过并在结果中提示）；源店铺 GID 绝不直接写入目标店铺，解析不了的引用一律留空并警告

**权限要求**：源站点 Token 需要 `read_metaobjects` + `read_metaobject_definitions`，目标站点 Token 需要 `write_metaobjects` + `write_metaobject_definitions`。

## Shopify API 权限

需要以下 Admin API Access Token 权限（scopes）：

- `read_themes` — 读取主题列表和模板内容
- `read_files` — 通过 GraphQL 解析文件 URL
- `write_files` — 推送图片到目标站点（仅目标站点需要）
- `read_metaobjects` / `read_metaobject_definitions` — 读取元对象（源站点）
- `write_metaobjects` / `write_metaobject_definitions` — 迁移元对象（仅目标站点需要）

## 开发命令

```bash
npm run dev        # 启动开发服务器
npm run build      # 生产构建
npm run start      # 启动生产服务器
npm run lint       # ESLint 检查
npm run format     # Prettier 格式化
npm run typecheck  # TypeScript 类型检查
```
