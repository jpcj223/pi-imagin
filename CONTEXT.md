# Pi Imagin 的环境术语

Pi Imagin 服务本身的运行环境，与执行项目命令时使用的环境不同。讨论配置、权限或故障时，按下面的术语区分。

## 服务端运行环境

Pi Imagin 服务及其框架运行的环境，英文为 Host Runtime Environment。这里讨论的是服务进程，不是项目命令使用的环境。

## 项目命令环境

在所选项目中执行命令时实际提供给命令的环境，英文为 Project Command Environment。它不等同于服务端运行环境，也不等同于服务进程继承的全部环境。

## 内置项目 Shell

Pi Imagin 提供的项目命令入口，在项目工作目录中执行命令，英文为 Built-in Project Shell。第三方扩展自行启动的 Shell 和其他子进程另行说明，不统称为内置项目 Shell。
