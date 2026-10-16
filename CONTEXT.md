# Pi Imagin 的环境术语

Pi Imagin 的服务运行环境与项目命令环境各有职责。以下术语用于区分配置、权限和故障所属的范围。

## 服务端运行环境

Pi Imagin 服务及其框架运行的环境，英文为 Host Runtime Environment，承担 API 请求、会话管理和 SDK 调度等职责。桌面版使用内置 Node.js 承载本地服务。

## 项目命令环境

在所选项目中执行命令时实际提供给命令的环境，英文为 Project Command Environment，包含该命令使用的工作目录、环境变量和可用工具。其配置与服务运行环境分别管理。

## 内置项目 Shell

Pi Imagin 提供的项目命令入口，在项目工作目录中执行命令，英文为 Built-in Project Shell。第三方扩展自行启动的 Shell 和其他子进程按各自实现说明。
