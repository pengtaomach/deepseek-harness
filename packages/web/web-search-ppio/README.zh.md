# @deepseek-ai/dsh-web-search-ppio

[English](README.md) | 中文

由 PPIO 代理支持的 `WebSearchProvider`，用于 harness 的 [web 能力 seam](../web/README.md)（`ctx.web`）。它调用代理专用的 `POST /web-search` 检索端点，并把 Tavily 格式的响应（可选的 `answer` 加 `results[]`）映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册 provider，不拥有密钥，也不注册面向模型的工具。与 `@deepseek-ai/dsh-web-search-deepseek` 一样，它是函数/命名空间插件（`inject: ['web']`）。`/web-search` 的 wire 格式是 provider 私有细节——它**不**让本 provider 依赖 `ctx.llm`。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `apiKey` | （未设置） | 字面代理 API 密钥。为空/缺省时回落为 `apiKeyEnv` 解析。 |
| `apiKeyEnv` | `PPIO_API_KEY` | 每次搜索时通过 credentials seam 解析的凭据引用，之后回落为启动环境。 |
| `baseURL` | `https://apiproxy.paigod.work/v1` | 端点基址；`/web-search` 会被追加。无法解析的值会使 provider 不可用。 |
| `model` | `ppio-tavily-search` | 搜索模型名；代理对该模型返回 Tavily 格式的响应体。 |

```yaml
- id: web-search-ppio
  name: '@deepseek-ai/dsh-web-search-ppio'
  config:
    apiKeyEnv: PPIO_API_KEY
    baseURL: https://apiproxy.paigod.work/v1
    model: ppio-tavily-search
```

provider 通过 web seam 的 `searchProvider` 配置（或 `$DSH_WEB_SEARCH_PROVIDER`）选择，因此把它挂载到另一个搜索 provider 旁边绝不会改变默认选择。`baseURL` 与 `model` 字段也会从 `web-search-ppio` settings 分节解析，因此配置界面可在浏览器中编辑它们而无需重启。

## 映射

`content` ← `answer`（代理可选的生成答案）。`sources[]` ← `results[]`（`url`、`title`、`snippet` ← `content`）。空字段会被省略而非置空。provider 失败以 `WebError` `WEB_PROVIDER_ERROR` 呈现；缺少密钥以 `WEB_PROVIDER_CREDENTIAL_MISSING` 呈现；已中止的请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在联系 `Location` 目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。代理没有结果数量控制，因此 `maxResults` 由 seam 强制执行（截断 `sources[]` 并置位 `truncated`）。

## 模型体验

### 辅助 PPIO 请求

#### 模型看到什么

独立的 PPIO 搜索模型通过 `/web-search` 端点原样接收 `<query>`。该请求不属于会话模型的上下文。

#### Token 影响

检索不是 LLM 调用；搜索本身不产生会话模型的 token。

#### KV Cache 影响

与会话请求缓存无关。

### 会话工具结果（间接）

#### 模型看到什么

通过 [`dsh-tool-web`](../tool-web/README.md)，会话模型看到可选答案与结构化来源元数据。本 provider 的具体失败消息有 `PPIO search aborted`、`PPIO search request failed: <error>`、`PPIO search credential resolution failed: <error>`、`PPIO search has no API key for "<ref>"; ...` 和 `PPIO returned an unprocessable response body: <error>`；HTTP 失败保留 provider 消息。错误包装归消费者所有。

#### Token 影响

注册本身不产生直接的会话 token。答案与来源 token 取决于数据，来源数量受服务上限约束，保留的结果或错误会一直重发直到压缩。

#### KV Cache 影响

仅追加；新可见内容跟随可复用的请求前缀，不会使现有 KV 缓存条目失效。

## 已知限制与暂缓事项

- **只支持 Tavily 格式响应**——代理的 `ppio-web-search` 模型返回 Bing 格式响应体（`data.webPages.value[]`），本 provider 不解析；只支持 Tavily 格式的 `ppio-tavily-search` 模型。
- **结果数量是事后截断**——wire 上无法控制数量，`maxResults` 只由 seam 截断强制执行。
