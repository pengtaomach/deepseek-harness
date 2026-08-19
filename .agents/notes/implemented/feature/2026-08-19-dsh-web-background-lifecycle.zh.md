# Agent Note: `dsh web start|stop|restart|status` 后台生命周期

Status: implemented

[English](2026-08-19-dsh-web-background-lifecycle.md) | 中文

## 问题

运行 GUI 意味着要为 `dsh web` 一直占着一个终端，或者自己去产品外做一遍守护进程化。长时间运行的 web 服务器只需要四个操作——后台启动、停止、重启、状态查询——而 CLI 里一个都没有。

## 决策

四个子命令嵌套在已有的 `web` 别名之下，见 [`args.ts`](../../../../apps/cli/src/args.ts)；运行器位于 [`web-daemon.ts`](../../../../apps/cli/src/web-daemon.ts)。

**action token 路由到 daemon，绝不进入应用。** `web` 原本会把每个无法识别的 token 原样转发给 web 应用；现在 `start|stop|restart|status` 被明确占用，其余 token 依旧转发（`dsh web serve` 会以位置参数启动应用）。Commander 在处理 variadic 参数之前先匹配已注册的子命令，因此路由是显式的，而不是字符串前缀猜测。

**daemon 重新发起运行本 CLI 的那条命令本身。** 子进程是 `spawn(process.execPath, [...process.execArgv, process.argv[1], 'web', ...])`，因此源码 checkout 的 tsx 加载器与入口在 daemon 上同样生效——从源码启动的 daemon 提供重建自源码的 bundle，而安装版的 daemon 提供其安装的 bundle。`detached: true` 让 POSIX 子进程成为自身进程组的组长，`stop` 对进程组发信号（问题在于：tsx 加载器进程并不是服务器进程；只给组长发信号会把服务器变成孤儿），失败时回退为只对组长 pid 发信号以兼容 Windows。

**状态由同一个日志目录下的两个文件承载。** `dsh-web.log` 追加每次运行的输出；`dsh-web.pid` 记录进程组组长；两者默认位于 `$DSH_HOME/logs`，并可用 `--log-dir` 覆盖。记录在案的 pid 仍存活时 `start` 拒绝再次启动，陈旧的 pid 文件会被清掉，`--port` 在 fork 之前先做探测，因此端口占用会在命令处明确失败，而不是在已启动的 fiber 内失败。`stop` 在十秒的宽限期后把 SIGTERM 升级为 SIGKILL。

## 曾经考虑的替代方案

- **面向任意 profile 的顶层 `dsh daemon` 命令。** 暂缓：有产品理由长时间无头运行的只有 web profile；其余 profile 要么交互、要么一次性。在出现第二个消费者之前扩大语法会提前占住命名空间。
- **扁平命令（`dsh web:start`）。** 否决：冒号是 package 脚本的词汇；CLI 已有 `dsh web`，`dsh web start` 延续产品自身语法。
- **systemd/launchd 集成。** 否决：平台服务管理器回答的是另一个问题（开机自启），在某些系统上需要根级别配置，而且会把 pid 的叙事放到产品可及范围之外。
- **日志放在调用目录下。** 否决：用户在 `start` 与 `stop` 之间的 cwd 并不稳定，而 `$DSH_HOME` 已经是所有其他持久运行时工件的家。

## 影响

`dsh web start --port 3080` 分离出一个服务器，用户随后用 `dsh web status`、`dsh web restart`、`dsh web stop` 管理。pid 文件是唯一事实来源——通过 `dsh web`（前台）启动的服务器对 `status` 不可见，这是有意为之。

行为只在进程所在处定格：四个路由用例在 `args.spec.ts` 中做了单元测试，daemon 的拒绝分支、pid 文件处理、陈旧 pid 清理和端口探测在 `apps/cli/tests/web-daemon.spec.ts` 中做了单元测试。真正的 start/stop 往返会启动整个 web profile，属于 built-bin e2e 表层下一次扩展的范围。
