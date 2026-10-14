# Pi Imagin 发布说明

当前项目以本地开发为主，包名为 `pi-imagin`，`package.json` 中设置了 `private: true`，尚未配置自己的 npm 发布账号或远程仓库。自动更新已关闭，不再使用上游项目的发布地址。

## 本地开发与验证

```bash
npm ci
npm run dev
```

发布前完成类型检查、代码检查和相关测试。只有用户明确要求时才创建 Git 提交。

## 本地生产启动

先停止使用同一目录的开发服务，再构建并启动：

```bash
npm run build
node bin/pi-imagin.js
```

## 配置独立发布目标

计划公开发布时，由项目所有者指定远程仓库和 npm 包归属，再配置发布凭据、包元数据与更新地址。`PI_IMAGIN_REPOSITORY_URL` 可用于指定项目的发布说明地址；当前私有项目不会因此自动开启更新。不要指向原项目或假定新名称已在 npm 上发布。

原 MIT 许可证与作者声明保留在 `LICENSE`。
