# Pi Imagin 的环境术语

Pi Imagin 为用户选择的项目托管编程智能体会话，网页服务的运行环境与项目命令环境需要分开描述。

## 服务端运行环境

由 Pi Imagin 服务及其框架管理的环境，对应 Host Runtime Environment。不要称为项目环境或项目 Shell 环境。

## 项目命令环境

Pi Imagin 代表用户在所选项目中执行命令时提供的环境，对应 Project Command Environment。不要与服务端环境或未经处理的继承环境混用。

## 内置项目 Shell

由 Pi Imagin 管理、在项目工作目录中执行命令的 Shell 入口，对应 Built-in Project Shell。第三方扩展的 Shell 和任意子进程不属于这个概念。
