# Manus Website Builder 版本管理调研

> 调研日期：2026-09-27（Asia/Shanghai）
>
> 范围：Manus Website Builder / WebDev，不讨论 Manus 模型自身的版本号。
>
> 结论可信度：凡标为“已证实”的内容均来自 Manus 官方网站、官方产品文档或官方 API 文档；其余内容明确标为“推断”或“未知”。

> 本文保留调研时的产品建议，不作为当前 SDK 的实现约束。当前 SDK 仅封装 Bash、文件和 Git 操作，提交与版本发布分离；分支策略、业务校验与部署由宿主决定，具体接口见 [SDK README](../packages/sdk/README.md)。

## 一句话结论

Manus 公布出来的模型是“**单个网站拥有按时间排列的 checkpoint；每个 checkpoint 由一个 Git commit 支撑；发布系统只发布最新 checkpoint**”。官方同时承诺可查看变更、回滚旧版本，但没有公开回滚时究竟执行 `git revert`、`reset`、新建分支、merge、worktree，还是“复制旧快照后再提交”。因此，不能据现有证据断言 Manus 的旧版编辑一定会形成线性新版本，或它支持“忽略冲突的硬 merge”。

对本项目最有参考价值的不是猜 Manus 的 Git 命令，而是它公开呈现出的产品边界：**checkpoint 是版本实体，Git commit hash 是版本 ID，发布状态与 checkpoint 分离，对外发布永远取最新 checkpoint。**

## 已证实的事实

### 1. 每个 checkpoint 背后就是一个 Git commit

Manus 官方 API 将 checkpoint 定义为网站的“时间点快照”，明确说明它由 Git commit 支撑。每条 checkpoint 包含：

- `version_id`
- `message`
- `status`
- `created_at`

`website.listCheckpoints` 的字段说明更进一步写明：`version_id` 是“底层 Git commit hash”，`message` 是保存 checkpoint 时写入的 commit message。

来源：

- [Manus API：Website 概念说明](https://open.manus.ai/docs/v2/website)
- [Manus API：website.listCheckpoints](https://open.manus.ai/docs/v2/website.listCheckpoints)

### 2. 产品 API 把版本历史当作一个倒序列表，而不是向用户暴露 Git 图

`website.listCheckpoints` 返回全部 checkpoint，并明确按“最新在前”排序。公开响应结构没有 parent、branch、merge parents、tag、tree hash 等 Git 拓扑字段，只有版本 ID、描述、状态和创建时间。

这说明“用户可见的版本历史”至少在公开 API 层是**线性列表视图**；但这不能证明底层 Git 历史绝对没有分支或 merge commit。

来源：[Manus API：website.listCheckpoints](https://open.manus.ai/docs/v2/website.listCheckpoints)

### 3. “版本是否生成成功”和“哪个版本正在发布”是两套状态

checkpoint 的 `status` 只表示快照是否生成成功（`pending / success / failed / unspecified`），不代表它是否在线。当前线上版本由网站级的 `published_version_id` 或 `website.status.version_id` 指向。

这意味着 Manus 没有把“已提交”与“已部署”混为一谈：Git/checkpoint 管代码快照，publish state 管线上指针。

来源：

- [Manus API：Website，Checkpoint status vs. publish state](https://open.manus.ai/docs/v2/website#checkpoint-status-vs-publish-state)
- [Manus API：website.status](https://open.manus.ai/docs/v2/website.status)

### 4. 公开 API 只能发布最新 checkpoint，不能指定旧 checkpoint

`website.publish` 没有 `version_id` 参数，官方明确写明它“总是部署网站最新的 checkpoint”；API 文档也明确说，不能通过该 API 固定或发布某个旧 checkpoint。

因此，对 API 使用者来说，想让旧内容重新上线，不能简单执行 `publish(oldVersionId)`。旧内容必须先通过某种恢复动作成为“最新状态”，或使用 Manus 未公开的内部接口。

来源：

- [Manus API：website.publish](https://open.manus.ai/docs/v2/website.publish)
- [Manus API：Website 常见流程](https://open.manus.ai/docs/v2/website)

### 5. Manus 官方承诺“查看每次编辑”和“回滚旧版本”

Manus Website Builder 官方产品页将 “Version control & rollback” 作为功能，描述为：可审查每次编辑，并在变更被跟踪的情况下回滚到过去版本。

但该页面没有解释回滚后的 Git 拓扑，也没有说明旧版恢复会不会创建一个新的 checkpoint。

来源：[Manus Website Builder：Version control & rollback](https://manus.im/features/webapp)

### 6. GitHub 同步围绕 `main` 分支工作，并采用“改之前先拉取”

Manus 官方 GitHub Integration 文档说明：

- Manus 导出项目时创建新的私有 GitHub 仓库；
- Manus workspace 与该仓库建立双向同步；
- Manus 生成或修改代码后，自动 push 到 `main`；
- Manus 开始新的代码修改前，先 pull `main` 的最新版本；
- 用户也可以在本地 IDE 修改并直接 push 回 `main`；
- 文档只说这种做法“降低冲突风险”，没有承诺彻底消除冲突。

这是一条很重要的旁证：Manus 的公开协作路径偏向“单主线 + pull-before-edit”，而不是向普通用户展示长期功能分支。

来源：[Manus 产品文档：GitHub Integration](https://manus.im/docs/website-builder/github-integration)

### 7. Manus 的“复制项目”只复制最新 commit，不是从任意旧版本分叉

官方 Make a Copy 文档说明，新项目复制的是源项目“最新 commit”的完整代码库；新项目是独立 session，未发布，GitHub 连接也不会继承。

因此，Make a Copy 是“复制当前最新版用于安全实验”，不是已公开的“从 V1 创建 V4”能力。

来源：

- [Manus 产品文档：Make a Copy](https://manus.im/docs/website-builder/make-a-copy)
- [Manus 官方博客：Make A Copy of your Manus Built Websites](https://manus.im/blog/manus-make-a-copy-webdev)

### 8. Manus 的 Session Branch 与 Web Builder 版本管理不是一回事

Manus 另有“从任意消息创建并行 session”的 Branch 功能，但官方明确写明它目前不支持 Web Builder session。不能用该功能证明网站 checkpoint 使用 Git branch。

来源：[Manus 官方博客：Introducing Branch](https://manus.im/blog/manus-branch)

## 针对当前问题的证据结论

| 问题 | 能否确认 | 结论 |
|---|---:|---|
| Manus 是否使用 Git 保存网站版本？ | 是 | checkpoint 由 Git commit 支撑，`version_id` 是 commit hash。 |
| 旧版本能否查看/回滚？ | 部分确认 | 官方承诺可 review 和 rollback；公开 API 可列历史，但没有公开旧版本内容读取/预览/回滚接口。 |
| 版本是否显示为 V1、V2、V3？ | 否 | 官方 schema 使用 commit hash 作为 `version_id`。文档示例出现过 `v003`，但正式字段定义是 Git hash，不能据此推断存在稳定的数字版本号。 |
| 从旧版本继续编辑后是否自动成为新的最新版本？ | 未公开 | 官方没有描述该流程。 |
| 回滚是否创建新 commit？ | 未公开 | 很合理，但没有官方证据。 |
| 是否使用 Git branch？ | 未公开 | 公开 checkpoint API 不暴露 branch；Session Branch 明确不适用于 Web Builder。 |
| 是否使用 worktree？ | 未公开 | 未发现任何官方材料提及。 |
| 是否通过 merge 合并旧版修改？ | 未公开 | 未发现官方材料提及 merge 策略或 parent 关系。 |
| 冲突怎么处理？ | 未公开 | GitHub 同步文档只说 pull-before-edit 可降低冲突风险，没有给出自动解决或强制覆盖规则。 |
| 能否“忽略冲突，硬 merge”？ | 无法确认 | 官方没有公开 `ours/theirs`、整树覆盖、force push 或 snapshot replace 等行为。 |

## 可以做出的工程推断（不是 Manus 官方事实）

### 推断 A：回滚很可能要把旧内容变成新的“最新 checkpoint”

理由是公开 API 只能发布最新 checkpoint，而官方产品又承诺可以回滚过去版本。最自然的实现是：选中旧 commit 的文件树，基于当前 HEAD 创建一个新的 checkpoint，使旧内容重新成为最新版本。

例如：

```text
C1(V1) ─ C2(V2) ─ C3(V3) ─ C4(恢复 V1 的内容)
```

其中 C4 的父提交是 C3，但 C4 的文件树可以等于 C1。这样历史仍是线性的，也不需要 merge 冲突。

不过仍存在其他可能：Manus UI 可能调用未公开接口，直接部署旧 commit，或内部执行 reset 后再生成新 checkpoint。所以这只能作为设计参考，不能称作 Manus 的已知实现。

### 推断 B：Manus 的产品抽象更接近“快照提交”，不是用户管理分支

证据是公开接口只展示倒序 checkpoint，GitHub 集成只自动同步 `main`，产品文档没有让用户选择 branch 或处理 merge graph。对非技术用户，Manus 很可能刻意隐藏了 Git 拓扑。

这同样不代表服务端没有临时 branch/worktree；只是它们不是公开产品语义。

## 对 artifact-editor 的直接建议

如果目标是复刻 Manus 已公开的产品模型，建议实现：

1. 每次可恢复编辑保存一个普通 Git commit，业务版本 ID 直接存 commit SHA，同时可额外显示 V1/V2/V3。
2. 正式版本只维护一条主线；版本列表按创建时间倒序展示。
3. “查看旧版本”只读取目标 commit 的 tree 做只读预览，不创建 worktree。
4. “恢复旧版本为最新版”不要做 merge：在当前 HEAD 后创建一个新 commit，其完整文件树取自旧 commit。这样 V1 → V2 → V3 → V4 保持线性，且 V4 内容可等于 V1。
5. 记录 `restored_from_commit` 或 `derived_from_version`，因为 Git 的单父提交关系只能表达 V4 接在 V3 后面，不能单独表达内容来源于 V1。
6. 发布系统只接受最新 checkpoint，与 Manus 的公开 API 一致。
7. 外部 GitHub 同步采用 fetch/pull + CAS 检查；远端已前进时停止发布并重新计算，而不是静默 force push。

这里的第 3～7 点是针对本项目的设计建议，并非 Manus 已公开的内部实现。

## 如果需要把“推断”升级成“事实”，应做的黑盒验证

使用一个可丢弃的 Manus WebDev 项目：

1. 创建三个内容明显不同的 checkpoint C1/C2/C3，并连接到独立 GitHub 仓库。
2. 记录 `website.listCheckpoints` 返回顺序、每个 SHA 和 GitHub `main` 的 log。
3. 在 Manus UI 中选择 C1 预览，确认只是只读查看时是否产生新 checkpoint。
4. 对 C1 执行 Rollback，随后再次记录 API 列表与 Git log。
5. 判断结果：
   - 新增 C4，父为 C3，tree 等于 C1：线性“快照恢复”；
   - `main` 移回 C1：历史重写/reset；
   - 出现两个 parent：merge commit；
   - API 的线上指针改成 C1、但无新 commit：部署指针回退。
6. 再从恢复后的状态做一次修改，观察新提交的 parent。
7. 制造 GitHub 与 Manus 同时修改同一行的场景，验证冲突是阻断、自动偏向一方，还是整树覆盖。

在未完成这组实验前，任何关于 Manus 使用 `merge -X theirs`、`git reset`、worktree 或隐藏分支的说法都不可靠。

## 来源清单

以下页面均于 2026-09-27 访问：

1. [Manus API — Website](https://open.manus.ai/docs/v2/website)
2. [Manus API — website.listCheckpoints](https://open.manus.ai/docs/v2/website.listCheckpoints)
3. [Manus API — website.status](https://open.manus.ai/docs/v2/website.status)
4. [Manus API — website.publish](https://open.manus.ai/docs/v2/website.publish)
5. [Manus Website Builder](https://manus.im/features/webapp)
6. [Manus Docs — GitHub Integration](https://manus.im/docs/website-builder/github-integration)
7. [Manus Docs — Make a Copy](https://manus.im/docs/website-builder/make-a-copy)
8. [Manus Blog — Make A Copy of your Manus Built Websites](https://manus.im/blog/manus-make-a-copy-webdev)
9. [Manus Blog — Introducing Branch: One Context, Many Parallel Directions](https://manus.im/blog/manus-branch)
