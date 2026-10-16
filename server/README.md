# 后端

本机生成服务。封装 ComfyUI 工作流，只向前端提供规定好的生成接口。默认监听 `127.0.0.1:8741`。

Node.js 22 或更新，TypeScript，Hono，Vitest。与 `web`、`shared` 同属一个 npm workspace。

## 目录

```
server/src/index.ts       进程入口
server/src/app.ts         路由
server/src/runs.ts        运行、队列、取消
server/src/eta.ts         大约剩余时间
server/src/comfy.ts       ComfyUI
server/src/ollama.ts      Ollama
server/src/size.ts         按比例计算宽高
server/src/workflow.ts    填工作流
server/src/services/      生成服务
server/workflows/         工作流与映射
data/                     设置、耗时、结果图
```

`comfy`、`workflow`、`eta` 只给服务内部用，不对外暴露。

## 生成服务

同时只执行一条。重启后未完成的运行丢弃，结果图留在 `data/outputs/`。

`text.image`：文生图。

| 字段 | 规定 |
|---|---|
| `text` | 要画的内容，文本 |
| `ratio` | `1:1`、`2:3`、`3:2`、`16:9`、`9:16` |

`image.image`：图生图。不接收比例，比例取参考图的宽高。

| 字段 | 规定 |
|---|---|
| `text` | 要画的内容，文本 |
| `image` | 一张参考图，png、jpeg 或 webp |

两个服务各自对应一份工作流。文本和算好的宽高写入映射；`image.image` 再写入参考图。

## 宽高

目标像素量为 `1024 × 1024`。设宽高比为 `r = 宽 / 高`：

- 理想宽 = `sqrt(1024 × 1024 × r)`
- 理想高 = `sqrt(1024 × 1024 / r)`

宽和高各自四舍五入到最接近的 32 的倍数，最小为 32。恰好落在两个倍数正中时，取较大的那个。

文生图的 `r` 来自选项。图生图的 `r` 来自参考图像素宽高。由此得到：

| 比例 | 宽 × 高 |
|---|---|
| `1:1` | 1024 × 1024 |
| `2:3` | 832 × 1248 |
| `3:2` | 1248 × 832 |
| `16:9` | 1376 × 768 |
| `9:16` | 768 × 1376 |

## 接口

`GET /api/health`  
Comfy 是否可达，当前有没有运行。

`GET /api/services`  
服务名和输入字段。

`POST /api/services/:name`  
提交生成，返回 `{ id, etaMs }`。`text.image` 使用 JSON。`image.image` 使用 `multipart/form-data`，文件字段名为 `image`。

`GET /api/runs/:id`  
快照：`id`、`service`、`phase`、`etaMs`、`step`、`total`、`prompt`、`seed`、`error`。

`phase`：`queued`、`sampling`、`done`、`failed`、`cancelled`。

`GET /api/runs/:id/events`  
SSE，事件为 `progress`、`done`、`error`。

- `progress`：`phase`、`etaMs`、`step`、`total`
- `done`：`prompt`、`seed`、`image`（地址为 `/api/runs/:id/image`）
- `error`：`message`，一句中文

`GET /api/runs/:id/image`  
结果图。

`POST /api/runs/:id/cancel`  
取消排队，或打断正在出的图。

大约时间来自本机最近的成功记录。队列从空开始时，首次载入模型可能更久。

## 工作流

每个服务两份文件：Comfy 导出的 API JSON，以及一份映射。映射写明提示词、宽、高、种子对应的节点。`image.image` 的映射再写明参考图节点。缺字段则运行失败，并说明缺哪一项。

## 配置

`data/settings.json`：`comfyBase`。`ollamaBase`、`model` 仍保留，供 Ollama 接口使用。

ComfyUI 默认 `http://127.0.0.1:8188`。Ollama 默认 `http://127.0.0.1:11434`，模型默认 `qwen3.8t`。只允许本机和局域网地址，拒绝公网地址和带账号密码的地址。端口用环境变量 `PORT`。

## 测试

用假的 Comfy 覆盖：地址校验、两份工作流的填充、上表五种比例、按原图比例取整、进度事件、取消、参考图缺失。
