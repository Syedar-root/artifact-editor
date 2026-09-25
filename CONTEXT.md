# Artifact Editor

这个上下文描述可编辑产物与围绕产物进行的 Agent 对话。它刻意保持最小，只定义需要被宿主系统理解的业务对象。

## Language

**Artifact**:
一个可被持续修改的产物，同时代表它自己的共享工作区。一个 Artifact 可以拥有多个 Session，所有 Session 都操作它的当前内容。
_Avoid_: Project、Workspace、Build

**Session**:
绑定到一个 Artifact 的 Agent 对话。Session 保存对话上下文，但不拥有独立的产物副本或版本。
_Avoid_: Branch、Revision、Workspace
