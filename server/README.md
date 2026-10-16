# 后端

本机生成服务。封装 ComfyUI 工作流，只向前端提供规定好的生成接口。默认监听 `127.0.0.1:8741`。

Node.js 22 或更新，TypeScript，Hono，Vitest。与 `web`、`shared` 同属一个 npm workspace。

## 目录

```
server/src/index.ts       进程入口
server/src/app.ts         路由
server/src/runs.ts        运行、队列、取消
server/src/history.ts     历史记录与过期清理
server/src/eta.ts         大约剩余时间
server/src/comfy.ts       ComfyUI
server/src/ollama.ts      Ollama
server/src/size.ts         按比例计算宽高
server/src/workflow.ts    填工作流
server/src/services/      生成服务
server/workflows/         工作流与映射
data/                     设置、耗时、结果图、历史
```

`comfy`、`workflow`、`eta` 只给服务内部用，不对外暴露。

## 生成服务

同时只执行一条。重启后未完成的运行丢弃，结果图留在 `data/outputs/`。

`text.image`：文生图。

| 字段 | 规定 |
|---|---|
| `text` | 要画的内容，文本 |
| `ratio` | `1:1`、`2:3`、`3:2`、`16:9`、`9:16` |
| `scale` | `1k`、`1.5k`、`2k`。不传时按 `1k` |

`image.image`：图生图。不接收比例，比例取参考图的宽高。

| 字段 | 规定 |
|---|---|
| `text` | 要画的内容，文本 |
| `image` | 一张参考图，png、jpeg 或 webp |
| `scale` | `1k`、`1.5k`、`2k`。不传时按 `1k` |

两个服务各自对应一份工作流。文本、算好的宽高和清晰度边长写入映射；`image.image` 再写入参考图。

## 宽高

清晰度决定目标像素量。标清 `1k` 为 `1024×1024`，高清 `1.5k` 为 `1536×1536`，超清 `2k` 为 `2048×2048`。设边长为 `e`，宽高比为 `r = 宽 / 高`：

- 理想宽 = `sqrt(e × e × r)`
- 理想高 = `sqrt(e × e / r)`

宽和高各自四舍五入到最接近的 32 的倍数，最小为 32。恰好落在两个倍数正中时，取较大的那个。工作流里的 `resolution` 写成同一档的边长。

文生图的 `r` 来自选项。图生图的 `r` 来自参考图像素宽高。由此得到：

| 比例 | 标清 | 高清 | 超清 |
|---|---|---|---|
| `1:1` | 1024 × 1024 | 1536 × 1536 | 2048 × 2048 |
| `2:3` | 832 × 1248 | 1248 × 1888 | 1664 × 2496 |
| `3:2` | 1248 × 832 | 1888 × 1248 | 2496 × 1664 |
| `16:9` | 1376 × 768 | 2048 × 1152 | 2720 × 1536 |
| `9:16` | 768 × 1376 | 1152 × 2048 | 1536 × 2720 |

## 接口

`GET /api/health`  
Comfy 是否可达，当前有没有运行。

`GET /api/services`  
服务名和输入字段。

`POST /api/services/:name`  
提交生成，返回 `{ id, etaMs }`。请求头 `X-Huijing-Client` 必须是 UUID，否则拒绝并说明缺少客户端标识。`text.image` 使用 JSON。`image.image` 使用 `multipart/form-data`，文件字段名为 `image`。

`GET /api/history`  
需要同一个客户端请求头。返回该客户端的历史，新的在前。先清理过期记录。每项含 `id`、`createdAt`、`prompt`、`service`、`image`。

`DELETE /api/history/:id`  
删除这个客户端名下的一张图和它的文件。不是自己的图时，按没有这张图处理。

`GET /api/runs/:id`  
快照：`id`、`service`、`phase`、`etaMs`、`step`、`total`、`prompt`、`seed`、`error`。

`phase`：`queued`、`sampling`、`done`、`failed`、`cancelled`。

`GET /api/runs/:id/events`  
SSE，事件为 `progress`、`done`、`error`。

- `progress`：`phase`、`etaMs`、`step`、`total`
- `done`：`prompt`、`seed`、`image`（地址为 `/api/runs/:id/image`）
- `error`：`message`，一句中文

`GET /api/runs/:id/image`  
结果图。内存里有就直接返回。重启后，未过期的历史图从 `data/outputs/` 读取。

每个浏览器最多 12 张。生成时刻起满 7 天的记录和文件会被删除。清理发生在进程启动、读取历史、以及新图写入之后，并扫过全部浏览器。失败和取消不写入历史。

`POST /api/runs/:id/cancel`  
取消排队，或打断正在出的图。

大约时间来自本机最近的成功记录。队列从空开始时，首次载入模型可能更久。

## 工作流

每个服务两份文件：Comfy 导出的 API JSON，以及一份映射。映射写明提示词、宽、高、种子、分辨率对应的节点。`image.image` 的映射再写明参考图节点。缺字段则运行失败，并说明缺哪一项。

## 配置

`data/settings.json`：`comfyBase`。`ollamaBase`、`model` 仍保留，供 Ollama 接口使用。

ComfyUI 默认 `http://127.0.0.1:8188`。Ollama 默认 `http://127.0.0.1:11434`，模型默认 `qwen3.8t`。只允许本机和局域网地址，拒绝公网地址和带账号密码的地址。端口用环境变量 `PORT`。

## 测试

用假的 Comfy 覆盖：地址校验、两份工作流的填充、三档清晰度和五种比例、按原图比例取整、进度事件、取消、参考图缺失、未知清晰度、历史隔离、12 张上限、7 天过期、非法客户端标识、重启后读图。
