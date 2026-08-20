# Agent Note: 基于专用 `/web-search` 端点的 PPIO 代理搜索 provider

Status: implemented

[English](2026-08-19-ppio-proxy-web-search.md) | 中文

## 问题

搜索走 PPIO 代理（apiproxy.paigod.work）的部署无法使用 `web-search-deepseek`：该 provider 依赖 DeepSeek 原生的 `web_search_20250305` 服务器工具，而代理并不转发它。代理反而暴露了一个纯检索操作 `POST /web-search`，返回 Tavily 或 Bing 格式的响应体——而现有的 `WebSearchProvider` 没有哪一个会读取这种格式。

## 决策

`@deepseek-ai/dsh-web-search-ppio` 注册一个 `WebSearchProvider`（`id: 'ppio'`），调用代理的 `/web-search` 端点并映射 Tavily 格式的响应。它挂载在 base bundle 中、位于已发布的 DeepSeek provider 旁边，但通过 web seam 的 `searchProvider` 配置或 `$DSH_WEB_SEARCH_PROVIDER` 选择——因此除非某个部署主动选择，已发布的默认值仍是 `deepseek-official`。

**检索不是 LLM 调用。** provider 直接 POST `{ model, query }` 并解析响应；它不导入任何 `ctx.llm` 接口，与 perplexity 的 provider 私有 wire 格式保持一致。

**凭据每次搜索解析一次，与 DeepSeek provider 相同。** 密钥是一个 `credentialRef`，通过 credentials seam 解析（回落到启动环境），绝不会以字面量保留在 provider 上，因此存储或轮换的 `PPIO_API_KEY` 无需重启，也不会有任何密钥搭乘响应返回。

**既有 settings 分节，也有 cordis 配置。** `web-search-ppio` 命名空间解析 `baseURL`/`model`/`apiKeyEnv`，因此配置界面可在浏览器中编辑接口地址与模型；provider 每次搜索时投影该分节，一次提交的改动无需重新注册。

**刻意只支持一种响应格式。** 代理的 `ppio-tavily-search` 模型以 Tavily 格式作答（`answer` + 带 `url`/`title`/`content` 的 `results[]`），可直接映射为 `content` 与 `sources[]`。Bing 格式的 `ppio-web-search` 响应体暂不解析，记录为暂缓事项而非凭空猜测。

## 曾经考虑的替代方案

- **给 `web-search-deepseek` 换代理 base URL 复用。** 否决：代理的 Messages 端点会忽略原生 `web_search` 工具，返回声称没有执行搜索的散文（已针对在线端点验证），因此 DeepSeek provider 的严格模式会正确地失败。
- **通过 `ctx.llm` 用代理的 `ppio-web-search` 模型路由搜索。** 否决：该模型是 settings 目录里的一个检索名称，而不是 harness 能流式调用的 LLM 路由；`/web-search` 操作是唯一可用的表层。
- **同时解析 Tavily 与 Bing 两种格式。** 暂缓：Bing 的 `webPages.value[]` 同样能干净映射，但在出现消费者之前就引入第二种格式，会凭空让响应契约翻倍；note 的暂缓事项条目已记录。

## 影响

PPIO 代理部署可以选择 `ppio` 作为搜索 provider，得到结构化的 `web_search` 结果。映射、错误表层与 settings 分节行为在 `packages/web/web-search-ppio/tests/` 中有单元测试；该 provider 挂载在 base bundle 中但未被选中，因此其他所有部署的默认搜索不受影响。
