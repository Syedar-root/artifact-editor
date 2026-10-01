# Artifact Editor

这个上下文描述可编辑产物与围绕产物进行的 Agent 对话。它刻意保持最小，只定义需要被宿主系统理解的业务对象。

## Language

**Artifact**:
用户眼中可被持续修改的产物。一个 Artifact 关联一个当前 Workspace，可以拥有多个 Session；所有 Session 都操作它的当前内容。
_Avoid_: Project、Sandbox、Build

**Sandbox**:
一个用户使用的执行环境。环境中的所有产物目录属于该用户，一个 Sandbox 可以包含多个 Workspace。
_Avoid_: Artifact、Session、Workspace

**Workspace**:
Sandbox 中对应一个产物的操作目录，承载该产物的文件、版本和构建操作。多个 Session 共享它的当前内容。它是宿主的业务概念，SDK 只接收目录路径，不要求创建 Workspace 实体。
_Avoid_: Artifact、Sandbox、Session

**Session**:
绑定到一个 Artifact 的 Agent 对话。Session 保存对话上下文，但不拥有独立的产物副本或版本。
_Avoid_: Branch、Revision、Workspace

**Element Draft**:
当前消息中针对某个唯一预览元素的待发送修改，包含给 Agent 的评论和已应用的直接调整；再次激活同一元素时继续编辑同一份草稿。
_Avoid_: Selected Element、Popover、Prompt

**Current Element Draft**:
当前正在编辑的 Element Draft；任一时刻至多存在一个，可以是新选择产生的草稿，也可以是发送列表中恢复的草稿。
_Avoid_: Active Selection、Focused Item

**Checkpoint**:
Artifact 源码的一份不可变快照，拥有 Artifact 内单调递增的版本号，可以独立于 Git 分支结构被查看或作为后续编辑起点。
_Avoid_: Revision、Branch、Session

**Historical Preview**:
对非当前 Checkpoint 的只读查看状态；不会改变 Checkpoint，也不能直接接受 Agent 修改。
_Avoid_: Rollback、Checkout
