# 本地 NAS 模拟

`artifacts/` 保存产物源码、Git 历史和 lockfile，由 `compose.sandbox.yaml` 挂载到沙箱 `/workspace`。`releases/` 保存完整构建结果和构建状态，由 Server 直接访问。这两个数据目录已被 Git 忽略。

沙箱 `/opt/artifact-dependencies` 使用临时存储，重启后依赖消失，源码和构建结果保留。已完成的 `/published/.../` 页面由 Server 提供，沙箱停止后仍然可访问。

启动本地模拟沙箱：

```sh
docker compose -f compose.sandbox.yaml up -d --build
```

在 Server 环境中配置：

```dotenv
ARTIFACT_SANDBOX_URL=http://127.0.0.1:18081
ARTIFACT_WORKSPACE_ROOT=/workspace
ARTIFACT_DEPENDENCY_ROOT=/opt/artifact-dependencies
ARTIFACT_RELEASE_ROOT=mock-nas/releases
ARTIFACT_BUILD_ROOT=/tmp/artifact-builds
ARTIFACT_PACKAGE_MANAGER=pnpm
```

重新启动 Server 后创建产物。使用 `docker compose -f compose.sandbox.yaml restart sandbox` 模拟临时依赖丢失，再重新打开产物，系统会按保存的 lockfile 恢复依赖和预览。

也可使用 `docker compose -f compose.sandbox.yaml up -d --force-recreate` 完全替换模拟沙箱。源码与 Git 历史仍从同一个目录挂载，已构建的分享页面由 Server 继续提供。安装和构建的临时挂载需要支持执行命令，Compose 已为 tmpfs 设置 `exec`。

配置可以放入忽略提交的 `apps/server/.env`，模型配置继续从根目录 `.env` 读取。复制旧产物到 NAS 后需确保目录属于沙箱执行用户（本镜像的 `gem` 为 UID/GID 1000），否则 Git 会拒绝使用所有者不匹配的仓库；不要通过关闭 Git 的全局检查绕过目录权限问题。

Linux 上首次挂载前创建 `mock-nas/artifacts` 并赋予 UID/GID 1000 写权限，`mock-nas/releases` 则需要 Server 用户可写。Windows Docker 挂载会改变旧文件的执行位；复制已有 Git 仓库后，如果差异只有 `100644 => 100755`，对这些仓库设置 `git config core.filemode false`，避免把挂载权限变化当成源码修改。

生产环境将 `mock-nas/artifacts` 换成沙箱的 NAS 挂载，将 `ARTIFACT_RELEASE_ROOT` 指向 Server 的 NAS 挂载。沙箱访问地址由部署平台保持稳定；若地址变化，应更新 Server 连接配置后重新启动。这里不自行创建云厂商沙箱，也不自动重放失效期间的 Agent 写入操作。
