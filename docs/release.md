# Pi Imagin 发布说明

源码仓库为 [pi-imagin](https://github.com/jpcj223/pi-imagin)，包名为 `pi-imagin`。`package.json` 设置了 `private: true`，目前未发布到 npm；Windows 安装包由本地构建流程生成。自动更新保持关闭。

## 本地开发与验证

```bash
npm ci
npm run dev
```

发布前根据变更影响完成类型检查、代码检查及相关测试，并核对版本、提交记录和构建产物。

## 本地生产启动

先停止使用同一目录的开发服务，再构建并启动：

```bash
npm run build
node bin/pi-imagin.js
```

## 配置独立发布目标

公开发布前需确认目标仓库、npm 包归属、发布凭据及包元数据，并配置独立的更新地址。`PI_IMAGIN_REPOSITORY_URL` 用于指定项目发布说明地址，单独设置该变量不会开启自动更新。发布地址须对应 Pi Imagin 自身的发布目标，npm 包状态以实际发布结果为准。

原 MIT 许可证与作者声明保留在 `LICENSE`。
