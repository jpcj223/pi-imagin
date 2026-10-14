import {
  createAgentSessionServices,
  getAgentDir,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { rememberProviderModels } from "./deferred-provider-models";

/**
 * 构建包含扩展注册服务商的 ModelRuntime。
 * 单独创建运行时只知道内置服务商和 models.json，会漏掉资源加载阶段注册的模型。
 * 使用智能体目录作为 cwd，排除项目专用扩展并加载全局扩展。
 * 不缓存实例，确保认证状态、登录和登出读取最新凭据。
 */
export async function createModelRuntimeWithExtensions(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  const services = await createAgentSessionServices({ cwd: agentDir, agentDir });
  await rememberProviderModels(services.modelRuntime);
  return services.modelRuntime;
}
