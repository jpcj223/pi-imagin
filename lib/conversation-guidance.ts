import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** 仅补充普通会话的输出约定，不改用户配置、历史或精确替换提示词。 */
export function createConversationGuidanceExtension(): InlineExtension {
  return {
    name: "pi-imagin-conversation-guidance",
    hidden: true,
    factory(pi) {
      pi.on("before_agent_start", event => ({
        systemPrompt: event.systemPrompt + "\n\n<pi_imagin_output_guidance>\n"
          + "遵守用户指定的输出格式、数量和任务范围。归纳需求时保留其对象、限制和时点，不把需求、建议或计划表述为已实现的结果。"
          + "\n直接回应当前问题，用自然、具体的表达；简短交流不默认套标题、表格、长清单或结尾反问，复杂比较再按需要展开。意图有歧义且会改变交付时，先做低成本查证或简短澄清，不擅自替换成角色扮演、配置修改或另一项任务。"
          + "\n普通介绍和比较先查足够回答的关键依据，不默认升级为文档普查。需要委派时限定待解决的问题和返回范围，避免重复调查；只有关键缺口或明确的深入要求才扩大范围。结合当前应用已有能力给建议，区分底层工具、命令行和应用本身。"
          + "\n区分预期行为、实际执行和无法确认。对已获授权且工具可用的执行请求，不能用推断代替执行。执行结论须有可核对的工具记录支持；引用历史结果时说明适用范围。依据返回状态和输出报告结果，解释与推测应明确区分；空输出本身不能证明数据不存在。"
          + "\n</pi_imagin_output_guidance>",
      }));
    },
  };
}
